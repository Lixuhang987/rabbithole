import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { abortError, BridgeError } from "../errors.js";
import { buildClaudeInput } from "../messages.js";
import {
  CLAUDE_REASONING,
  claudeModelEntries,
  parseClaudeAliases,
} from "../models.js";
import { startingAgent } from "../state.js";
import {
  parseJsonOutput,
  resolveExecutable,
  runCaptured,
  terminateChild,
} from "./isolation.js";
import { errorCode } from "../../shared/errno.js";
import { createNdjsonReader } from "../../shared/ndjson.js";
import { openAiUsage, probeAgent } from "./agent.js";

const FIRST_EVENT_TIMEOUT_MS = 15_000;
const MCP_CONFIG = '{"mcpServers":{}}';
const INSTALL_FIX = "npm install -g @anthropic-ai/claude-code";
const LOGIN_FIX = "claude /login";

export const HARDENING_ARGS = [
  "--tools",
  "",
  "--disable-slash-commands",
  "--no-session-persistence",
  "--safe-mode",
  "--strict-mcp-config",
  "--mcp-config",
  MCP_CONFIG,
];

const LIST_MODEL_ARGS = [
  "-p",
  "/model",
  "--output-format",
  "json",
  "--tools",
  "",
  "--safe-mode",
  "--strict-mcp-config",
  "--mcp-config",
  MCP_CONFIG,
];

function finishReason(reason) {
  if (reason === "max_tokens") return "length";
  return "stop";
}

export function parseClaudeEvent(event) {
  if (event?.type === "system" && event.subtype === "init") {
    return {
      type: "init",
      tools: Array.isArray(event.tools) ? event.tools : [],
      mcpServers: Array.isArray(event.mcp_servers) ? event.mcp_servers : [],
    };
  }
  if (
    event?.type === "stream_event"
    && event.event?.type === "content_block_delta"
    && event.event?.delta?.type === "text_delta"
    && typeof event.event.delta.text === "string"
  ) {
    return { type: "delta", text: event.event.delta.text };
  }
  if (event?.type === "stream_event" && event.event?.type === "message_delta") {
    return {
      type: "message_delta",
      finishReason: finishReason(event.event.delta?.stop_reason),
      usage: openAiUsage(event.event.usage),
    };
  }
  if (event?.type === "result") {
    return {
      type: "result",
      isError: event.is_error !== false,
      message: typeof event.result === "string" ? event.result : "Claude turn failed",
      usage: openAiUsage(event.usage),
      finishReason: finishReason(event.stop_reason || event.terminal_reason),
      apiStatus: event.api_error_status,
    };
  }
  return null;
}

function resultError(parsed) {
  if (
    /not logged in|authenticate|bearer token|run \/login/i.test(parsed.message)
    || parsed.apiStatus === 401
  ) {
    return new BridgeError(
      "Claude Code is signed out. Run `claude /login` and try again.",
      "agent_signed_out",
      503
    );
  }
  if (parsed.apiStatus === 404 || /selected model|model.*(?:not exist|access)/i.test(parsed.message)) {
    return new BridgeError(
      "Claude Code could not use that model. Refresh models and try again.",
      "model_unknown",
      400
    );
  }
  return new BridgeError(
    "Claude Code could not complete the response. Try again.",
    "turn_failed",
    500
  );
}

export class ClaudeBackend {
  /** @param {{executable: string | null, env: NodeJS.ProcessEnv, cwd?: string}} options */
  constructor({ executable, env, cwd }) {
    this.executable = executable;
    this.env = env;
    this.cwd = cwd;
    this.children = new Set();
    this.closed = false;
  }

  /** @param {{env?: NodeJS.ProcessEnv, cwd?: string}} [options] */
  static create({ env = process.env, cwd } = {}) {
    const claudeEnv = { ...env };
    delete claudeEnv.CLAUDE_CONFIG_DIR;
    return new ClaudeBackend({
      executable: resolveExecutable(
        "claude",
        env.RABBITHOLE_BRIDGE_CLAUDE_BIN,
        env
      ),
      env: claudeEnv,
      cwd,
    });
  }

  initialState() {
    return startingAgent("claude", "Starting Claude Code");
  }

  async status() {
    if (!this.executable) {
      return { installed: false, signedIn: false, plan: null };
    }
    const result = await runCaptured(this.executable, ["auth", "status"], {
      cwd: this.cwd,
      env: this.env,
      timeoutMs: 10_000,
    }).catch(() => ({ code: 1, stdout: "" }));
    const details = parseJsonOutput(result.stdout) || {};
    return {
      installed: true,
      signedIn: result.code === 0 && details.loggedIn === true,
      plan: details.subscriptionType || null,
    };
  }

  async listModels() {
    const status = await this.status();
    if (!status.installed) {
      throw new BridgeError("Claude Code is not installed", "agent_missing", 503);
    }
    if (!status.signedIn) {
      throw new BridgeError(
        "Claude Code is signed out. Run `claude /login` and try again.",
        "agent_signed_out",
        503
      );
    }
    const result = await runCaptured(this.executable, LIST_MODEL_ARGS, {
      cwd: this.cwd,
      env: this.env,
      timeoutMs: FIRST_EVENT_TIMEOUT_MS,
    });
    const parsed = parseJsonOutput(result.stdout);
    if (result.code !== 0 || !parsed) {
      const message = parsed?.result || "";
      if (/not logged in|authenticate|run \/login/i.test(message)) {
        throw new BridgeError(
          "Claude Code is signed out. Run `claude /login` and try again.",
          "agent_signed_out",
          503
        );
      }
      throw new BridgeError(
        "Claude Code could not load its model list. Try again.",
        "turn_failed",
        500
      );
    }
    const aliases = parseClaudeAliases(parsed);
    if (!aliases.length) {
      throw new BridgeError(
        "Claude Code returned an empty model list.",
        "turn_failed",
        500
      );
    }
    return claudeModelEntries(aliases);
  }

  async probe() {
    return probeAgent({
      name: "claude",
      executable: this.executable,
      installFix: INSTALL_FIX,
      loginFix: LOGIN_FIX,
      errorFix: "claude -p /model",
      status: () => this.status(),
      models: () => this.listModels(),
    });
  }

  // The route (server.js handleChat) validates model, image capability, and
  // reasoning effort against the live catalog it fetches from this backend
  // immediately before calling generate — no re-validation here.
  /** @param {{model: string, messages: any[], reasoningEffort?: string, signal?: AbortSignal, onDelta?: (text: string) => void}} options */
  async generate({
    model,
    messages,
    reasoningEffort,
    signal,
    onDelta = () => {},
  }) {
    if (this.closed) throw new BridgeError("Claude backend is shutting down", "turn_failed", 500);
    if (signal?.aborted) throw abortError(signal);
    const effort = reasoningEffort || CLAUDE_REASONING.default;

    const { systemPrompt, input, imageCount, imagePartCount } = buildClaudeInput(messages);
    if (imagePartCount !== imageCount) {
      throw new BridgeError(
        "Claude image input must use an embedded base64 data URL.",
        "turn_failed",
        400
      );
    }
    const requestCwd = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-claude-turn-"));
    await fs.chmod(requestCwd, 0o700);
    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--model",
      model,
      "--effort",
      effort,
      "--system-prompt",
      systemPrompt,
      ...HARDENING_ARGS,
    ];

    try {
      return await new Promise((resolve, reject) => {
        let settled = false;
        let finalResult;
        let streamedUsage;
        let streamedFinishReason;
        let sawInit = false;
        const child = spawn(this.executable, args, {
          cwd: requestCwd,
          env: this.env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        this.children.add(child);
        child.stdout.setEncoding("utf8");
        child.stderr.resume();

        const cleanup = () => {
          clearTimeout(firstEventTimer);
          signal?.removeEventListener("abort", onAbort);
          this.children.delete(child);
        };
        const fail = (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          terminateChild(child);
          reject(error);
        };
        const reader = createNdjsonReader({
          onRecord: (raw) => {
            clearTimeout(firstEventTimer);
            const parsed = parseClaudeEvent(raw);
            if (parsed?.type === "init") {
              sawInit = true;
              if (parsed.tools.length || parsed.mcpServers.length) {
                fail(new BridgeError("Claude Code exposed tools despite bridge isolation.", "turn_failed", 500));
              }
            } else if (parsed?.type === "delta") {
              try { onDelta(parsed.text); } catch (error) { fail(error); }
            } else if (parsed?.type === "message_delta") {
              streamedUsage = parsed.usage || streamedUsage;
              streamedFinishReason = parsed.finishReason || streamedFinishReason;
            } else if (parsed?.type === "result") finalResult = parsed;
          },
        });
        const onAbort = () => fail(abortError(signal));
        const firstEventTimer = setTimeout(() => {
          fail(new BridgeError("Claude Code did not start in time.", "turn_failed", 500));
        }, FIRST_EVENT_TIMEOUT_MS);

        signal?.addEventListener("abort", onAbort, { once: true });
        child.once("error", (error) => {
          fail(new BridgeError(
            "Could not start Claude Code.",
            errorCode(error) === "ENOENT" ? "agent_missing" : "turn_failed",
            errorCode(error) === "ENOENT" ? 503 : 500
          ));
        });
        child.stdout.on("data", (chunk) => {
          try {
            reader.push(chunk);
          } catch {
            fail(new BridgeError("Claude Code returned an oversized response.", "turn_failed", 500));
          }
        });
        child.once("close", (code) => {
          if (settled) return;
          try { reader.end(); } catch {
            fail(new BridgeError("Claude Code returned an oversized response.", "turn_failed", 500));
            return;
          }
          if (!sawInit || !finalResult || finalResult.isError || code !== 0) {
            fail(finalResult ? resultError(finalResult) : new BridgeError(
              "Claude Code stopped before completing the response.",
              "turn_failed",
              500
            ));
            return;
          }
          settled = true;
          cleanup();
          resolve({
            text: finalResult.message,
            usage: finalResult.usage || streamedUsage,
            finishReason: finalResult.finishReason || streamedFinishReason || "stop",
          });
        });
        child.stdin.once("error", () => {
          fail(new BridgeError("Could not send the request to Claude Code.", "turn_failed", 500));
        });
        child.stdin.end(`${JSON.stringify(input)}\n`);
      });
    } finally {
      await fs.rm(requestCwd, { recursive: true, force: true });
    }
  }

  close() {
    this.closed = true;
    for (const child of this.children) terminateChild(child);
    this.children.clear();
  }
}
