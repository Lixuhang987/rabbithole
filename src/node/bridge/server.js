import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { CodexBackend } from "./agents/codex.js";
import { applyCors, isAllowedOrigin } from "./cors.js";
import { openEventStream } from "./events.js";
import {
  BridgeError,
  bridgeError,
  errorBody,
  isAbortError,
} from "./errors.js";
import { generationRequest } from "./input.js";
import { BridgeStateStore } from "./state.js";
import { readOrCreateBridgeToken, tokenMatches } from "./token.js";
import {
  closeServerGracefully,
  parseRequestBody,
} from "../shared/http.js";
import { assertHttpRequest } from "../shared/http-guard.js";
import { errorCode, errorStatusCode } from "../shared/errno.js";
const HOST = "127.0.0.1";

function sendJson(res, statusCode, body) {
  if (res.writableEnded || res.destroyed) return;
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function sendBridgeError(res, error) {
  const normalized = error instanceof BridgeError ? error : bridgeError(error);
  if (normalized.code === "unauthorized") {
    sendJson(res, 401, { error: { code: "unauthorized" } });
    return;
  }
  const payload = errorBody(normalized);
  sendJson(res, payload.statusCode, payload.body);
}

function sseData(res, value) {
  if (!res.destroyed && !res.writableEnded) {
    res.write(`data: ${typeof value === "string" ? value : JSON.stringify(value)}\n\n`);
  }
}

function isJsonContentType(value) {
  return /^application\/json(?:\s*;|$)/i.test(String(value || ""));
}

/** @param {unknown} error */
function requestError(error) {
  if (error instanceof BridgeError) return error;
  const statusCode = errorStatusCode(error);
  if (statusCode !== undefined) {
    return new BridgeError(error instanceof Error ? error.message : String(error), "turn_failed", statusCode);
  }
  return bridgeError(error);
}

/** @param {{port?: number, env?: NodeJS.ProcessEnv, version?: string, logger?: {warn?: (...args: any[]) => void}, newToken?: boolean, stateRefreshMs?: number}} [options] */
export async function createBridge({
  port = 41414,
  env = process.env,
  version = "0.0.0",
  logger,
  newToken = false,
  stateRefreshMs,
} = {}) {
  const { token, created: tokenCreated } = await readOrCreateBridgeToken({
    env,
    regenerate: newToken,
  });
  const codexCwd = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-bridge-codex-"));
  await fs.chmod(codexCwd, 0o700);

  let codex;
  try {
    codex = await CodexBackend.create({
      env,
      cwd: codexCwd,
      bridgeVersion: version,
    });
  } catch (error) {
    await Promise.allSettled([
      fs.rm(codexCwd, { recursive: true, force: true }),
    ]);
    throw error;
  }

  const state = new BridgeStateStore({
    version,
    backends: { codex },
    logger,
    ...(stateRefreshMs ? { refreshMs: stateRefreshMs } : {}),
  });
  let actualPort = port;
  let closing = false;
  let restartPromise = null;
  const activeControllers = new Set();

  async function restart() {
    if (closing) throw new BridgeError("Bridge is shutting down.", "bridge_restarting", 503);
    if (restartPromise) return restartPromise;
    if (activeControllers.size) {
      throw new BridgeError("Wait for current answers to finish, then restart the bridge.", "bridge_busy", 409);
    }
    restartPromise = (async () => {
      // Construct replacements before closing the working backends.
      const nextCodex = await CodexBackend.create({ env, cwd: codexCwd, bridgeVersion: version });
      await state.refreshPromise;
      if (closing) {
        await Promise.allSettled([nextCodex.close()]);
        throw new BridgeError("Bridge is shutting down.", "bridge_restarting", 503);
      }
      await Promise.allSettled([codex.close()]);
      codex = nextCodex;
      return state.replaceBackends({ codex });
    })().finally(() => { restartPromise = null; });
    return restartPromise;
  }

  function assertAvailable() {
    if (closing || restartPromise) {
      throw new BridgeError("Bridge is restarting. Try again shortly.", "bridge_restarting", 503);
    }
  }

  async function models() {
    assertAvailable();
    return codex.listModels();
  }

  async function handleGenerate(req, res, body) {
    assertAvailable();
    let streamStarted = false;
    let clientAborted = false;
    const controller = new AbortController();
    activeControllers.add(controller);
    const abortForClient = () => {
      if (res.writableEnded) return;
      clientAborted = true;
      controller.abort();
    };
    const onResponseClose = () => {
      if (!res.writableEnded) abortForClient();
    };
    req.once("aborted", abortForClient);
    res.once("close", onResponseClose);

    const startStream = () => {
      if (streamStarted || res.destroyed) return;
      streamStarted = true;
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();
    };

    try {
      const generation = generationRequest(body);
      const backend = state.backends[generation.backend];
      const catalog = await backend.listModels();
      const modelEntry = catalog.find((entry) => entry.id === generation.model);
      if (!modelEntry) throw new BridgeError(`Unknown model "${generation.model}".`, "model_unknown", 400);
      if (generation.input.some((part) => part.type === "image") && modelEntry.images !== true) {
        throw new BridgeError(`Model "${generation.model}" cannot accept images.`, "model_no_images", 400);
      }
      const effort = generation.reasoning || modelEntry.reasoning.default;
      if (!modelEntry.reasoning.options.includes(effort)) {
        throw new BridgeError("Unsupported reasoning effort.", "input_invalid", 400);
      }
      const result = await backend.generate({
        model: generation.model,
        input: generation.input,
        instructions: generation.instructions,
        sourceSession: generation.sourceSession,
        reasoningEffort: effort,
        signal: controller.signal,
        onSearch(event) { startStream(); sseData(res, { type: "search", ...event }); },
        onDelta(delta) { if (delta) { startStream(); sseData(res, { type: "text", delta }); } },
      });
      if (controller.signal.aborted) throw controller.signal.reason;
      if (!result.session || result.finishReason === "length") {
        throw new BridgeError("The backend did not complete its session.", "conversation_incomplete", 500);
      }
      startStream();
      sseData(res, { type: "completed", session: result.session, ...(result.usage ? { usage: result.usage } : {}) });
      res.end();
    } catch (error) {
      if (clientAborted || isAbortError(error)) return;
      const normalized = requestError(error);
      if (streamStarted) {
        sseData(res, { type: "error", ...errorBody(normalized).body.error });
        res.end();
      } else {
        sendBridgeError(res, normalized);
      }
    } finally {
      req.removeListener("aborted", abortForClient);
      res.removeListener("close", onResponseClose);
      activeControllers.delete(controller);
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${HOST}:${actualPort}`);
      const allowedHosts = new Set([
        `${HOST}:${actualPort}`,
        `localhost:${actualPort}`,
      ]);
      const origin = req.headers.origin;
      const publicRoute = req.method === "OPTIONS"
        || (req.method === "GET" && url.pathname === "/bridge/ping");
      assertHttpRequest(req, {
        allowedHosts,
        isAllowedOrigin,
        requireOrigin: req.method === "OPTIONS",
        ...(publicRoute ? {} : { authorize: (authorization) => tokenMatches(token, authorization) }),
        error: (message, code, statusCode) => new BridgeError(message, code, statusCode),
      });

      // Browser preflights cannot carry the bearer value. The Origin gate is
      // therefore the terminal authorization for OPTIONS only.
      if (req.method === "OPTIONS") {
        applyCors(req, res);
        res.writeHead(204);
        res.end();
        return;
      }

      // Pre-pairing liveness probe. An unpaired page can't read any authed
      // response (401 carries no ACAO header, so it fails identically to
      // "no bridge"), yet the setup panel must know when the bridge comes up
      // to advance its instructions. This reveals only that a bridge is
      // listening — which a port scan shows anyway — behind the same
      // Host/Origin gates as everything else.
      if (req.method === "GET" && url.pathname === "/bridge/ping") {
        applyCors(req, res);
        sendJson(res, 200, { ok: true });
        return;
      }

      applyCors(req, res);

      let body;
      if (req.method === "POST") {
        if (!isJsonContentType(req.headers["content-type"])) {
          throw new BridgeError(
            "Content-Type must be application/json.",
            "unsupported_media_type",
            415
          );
        }
        body = await parseRequestBody(req, { maxBytes: Infinity });
      }

      if (req.method === "GET" && url.pathname === "/bridge/events") {
        openEventStream(req, res, state);
      } else if (req.method === "GET" && url.pathname === "/bridge/models") {
        sendJson(res, 200, {
          models: await models(),
        });
      } else if (req.method === "POST" && url.pathname === "/bridge/restart") {
        sendJson(res, 200, { ok: true, state: await restart() });
      } else if (req.method === "POST" && url.pathname === "/bridge/generate") {
        await handleGenerate(req, res, body);
      } else {
        sendJson(res, 404, {
          error: {
            code: "turn_failed",
            message: "Route not found.",
          },
        });
      }
    } catch (error) {
      if (!res.writableEnded) sendBridgeError(res, requestError(error));
    }
  });

  async function start() {
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, HOST, () => {
          server.removeListener("error", reject);
          const address = server.address();
          if (!address || typeof address === "string") return reject(new Error("Bridge address unavailable"));
          actualPort = address.port;
          resolve();
        });
      });
    } catch (error) {
      await close();
      if (errorCode(error) === "EADDRINUSE") {
        throw new BridgeError(
          `Port ${port} is already in use.`,
          "turn_failed",
          500
        );
      }
      throw error;
    }
    codex.warmup();
    void state.refresh();
    return bridge;
  }

  async function close() {
    if (closing) return;
    closing = true;
    state.close();
    const shutdownError = new BridgeError(
      "Rabbithole bridge is shutting down.",
      "turn_failed",
      503
    );
    for (const controller of activeControllers) controller.abort(shutdownError);
    await Promise.allSettled([codex.close()]);
    if (server.listening) {
      await new Promise((resolve) => closeServerGracefully(server, { onClosed: () => resolve(undefined) }));
    }
    await Promise.allSettled([
      fs.rm(codexCwd, { recursive: true, force: true }),
    ]);
  }

  const bridge = {
    start,
    close,
    refreshState: () => state.refresh(),
    get port() {
      return actualPort;
    },
    get url() {
      return `http://${HOST}:${actualPort}`;
    },
    token,
    tokenCreated,
  };
  return bridge;
}
