import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { abortError, BridgeError } from "../errors.js";
import { codexModelEntry } from "../models.js";
import { startingAgent } from "../state.js";
import { resolveExecutable, terminateChild, runCaptured } from "./isolation.js";
import { createNdjsonReader } from "../../shared/ndjson.js";
import { tokenUsage, probeAgent } from "./agent.js";
import { SearchCitations, searchSources } from "./codex-search.js";
import { discoverEgoBrowser, egoBrowserInstructions } from "./ego-browser.js";

const INITIALIZE_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 20_000;
const INSTALL_FIX = "npm install -g @openai/codex";
const LOGIN_FIX = "codex login";

// Overlay only execution capabilities; provider, authentication and search remain user-owned.
export function codexIsolationArgs() {
  return [
    'sandbox_mode="danger-full-access"',
    'approval_policy="never"',
    'features.multi_agent=false',
    'features.multi_agent_v2=false',
    'agents.enabled=false',
    'features.goals=false',
    'features.plugins=false',
    'features.remote_plugin=false',
    'skills.include_instructions=false',
    'skills.bundled.enabled=false',
    'tools.experimental_request_user_input.enabled=false',
    'orchestrator.skills.enabled=false',
    'orchestrator.mcp.enabled=false',
  ].flatMap((override) => ["-c", override]);
}

async function launchArgs(executable, { env, cwd, egoBrowser }) {
  const overrides = [
    ...codexIsolationArgs(),
    "-c", "model_context_window=1000000",
    "-c", "model_auto_compact_token_limit=900000",
  ];
  // Empty tables merge with user configuration, so disable each configured server.
  const result = await runCaptured(executable, ["mcp", ...overrides, "list", "--json"], { env, cwd });
  let servers;
  try { servers = JSON.parse(result.stdout); } catch { /* Fail closed below. */ }
  if (result.code !== 0 || !Array.isArray(servers) || servers.some((server) => typeof server?.name !== "string")) {
    throw new BridgeError("Could not read Codex MCP configuration for isolation.", "turn_failed", 500);
  }
  if (servers.length || egoBrowser) {
    const entries = servers.map((server) => `${JSON.stringify(server.name)}={enabled=false}`);
    if (egoBrowser) {
      let name = "rabbithole_ego_browser";
      while (servers.some((server) => server.name === name)) name += "_";
      egoBrowser.serverName = name;
      const args = [fileURLToPath(new URL("./ego-browser-mcp.js", import.meta.url)), egoBrowser.executable, egoBrowser.skillPath];
      entries.push(`${JSON.stringify(name)}={enabled=true,command=${JSON.stringify(process.execPath)},args=${JSON.stringify(args)},enabled_tools=["ego_browser"]}`);
    }
    overrides.push("-c", `mcp_servers={${entries.join(",")}}`);
  }
  return ["app-server", ...overrides, "--listen", "stdio://"];
}

function turnError(value) {
  const text = typeof value === "string" ? value : value?.message || "";
  if (/401|unauthori[sz]ed|not logged in|authentication|api key/i.test(text)) {
    return new BridgeError(
      "Codex is signed out. Run `codex login` and try again.",
      "agent_signed_out",
      503
    );
  }
  if (/model.*(?:not found|unknown|access)|unsupported model/i.test(text)) {
    return new BridgeError(
      "Codex could not use that model. Refresh models and try again.",
      "model_unknown",
      400
    );
  }
  return new BridgeError(
    "Codex could not complete the response. Try again.",
    "turn_failed",
    500
  );
}

function findDefaultMode(value) {
  if (!value || typeof value !== "object") return null;
  if (String(value.mode || "").toLowerCase() === "default") return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findDefaultMode(child);
    if (found) return found;
  }
  return null;
}

export function parseCodexEvent(message) {
  const method = message?.method;
  const params = message?.params || {};
  if ((method === "item/started" || method === "item/completed") && params.item?.type === "webSearch") {
    return {
      type: "search",
      threadId: params.threadId,
      turnId: params.turnId,
      id: params.item.id,
      status: method === "item/started" ? "searching" : "completed",
      action: params.item.action?.type || "search",
      query: typeof params.item.query === "string" ? params.item.query : "",
      sources: searchSources(params.item.results),
    };
  }
  if (method === "item/started" && params.item?.type === "agentMessage") {
    return { type: "message_started", threadId: params.threadId, turnId: params.turnId, itemId: params.item.id, phase: params.item.phase };
  }
  if (method === "turn/started") {
    return {
      type: "turn_started",
      threadId: params.threadId,
      turnId: params.turn?.id,
    };
  }
  if (method === "item/agentMessage/delta" && typeof params.delta === "string") {
    return {
      type: "delta",
      itemId: params.itemId,
      threadId: params.threadId,
      turnId: params.turnId,
      text: params.delta,
    };
  }
  if (method === "item/completed" && params.item?.type === "agentMessage") {
    return {
      type: "completed_text",
      itemId: params.item.id,
      phase: params.item.phase,
      threadId: params.threadId,
      turnId: params.turnId,
      text: typeof params.item.text === "string" ? params.item.text : "",
    };
  }
  if (method === "thread/tokenUsage/updated") {
    return {
      type: "usage",
      threadId: params.threadId,
      turnId: params.turnId,
      usage: tokenUsage(params.tokenUsage?.last),
    };
  }
  if (method === "turn/completed") {
    return {
      type: "turn_completed",
      threadId: params.threadId,
      turnId: params.turn?.id,
      status: params.turn?.status,
      error: params.turn?.error,
    };
  }
  return null;
}

export class CodexAppServer {
  constructor({ executable, env, cwd, version }) {
    this.executable = executable;
    this.env = env;
    this.cwd = cwd;
    this.version = version;
    this.child = null;
    this.reader = createNdjsonReader({ onRecord: (message) => this.onMessage(message), maxLineChars: Infinity });
    this.pending = new Map();
    this.turns = new Map();
    this.nextId = 1;
    this.startPromise = null;
    this.initialized = false;
    this.account = null;
    this.requiresOpenaiAuth = true;
    this.planType = null;
    this.lastProtocolError = null;
    this.executeMode = null;
    this.modeList = null;
    this.closed = false;
    this.historyScopePromise = null;
    this.egoBrowser = null;
  }

  async ensureStarted() {
    if (this.closed) throw new BridgeError("Codex is shutting down.", "turn_failed", 500);
    if (this.child && this.initialized) return;
    if (!this.startPromise) {
      this.startPromise = this.start().finally(() => {
        this.startPromise = null;
      });
    }
    return this.startPromise;
  }

  async start() {
    if (!this.executable) {
      throw new BridgeError("Codex is not installed", "agent_missing", 503);
    }
    this.egoBrowser = await discoverEgoBrowser(this.env);
    const args = await launchArgs(this.executable, { env: this.env, cwd: this.cwd, egoBrowser: this.egoBrowser });
    if (this.closed) throw new BridgeError("Codex is shutting down.", "turn_failed", 500);
    const child = spawn(this.executable, args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.reader.reset();
    this.initialized = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.onStdout(chunk, child));
    child.stderr.resume();
    child.stdin.once("error", () => this.onCrash(child));
    child.once("error", () => this.onCrash(child));
    child.once("close", () => this.onCrash(child));

    try {
      await this.request("initialize", {
        clientInfo: {
          name: "rabbithole_bridge",
          title: "Rabbithole Bridge",
          version: this.version,
        },
        capabilities: { experimentalApi: true },
      }, {
        timeoutMs: INITIALIZE_TIMEOUT_MS,
        timeoutCode: "agent_missing",
      });
      this.notify("initialized", {});
      this.initialized = true;
      const modes = await this.request("collaborationMode/list");
      this.modeList = modes;
      this.executeMode = findDefaultMode(modes);
      if (!this.executeMode) {
        throw new BridgeError("Codex does not expose Default mode.", "turn_failed", 500);
      }
      await this.refreshAccount();
    } catch (error) {
      terminateChild(child);
      throw error;
    }
  }

  onStdout(chunk, child) {
    if (child !== this.child) return;
    try {
      this.reader.push(chunk);
    } catch {
      this.onCrash(child, new BridgeError("Codex returned an oversized response.", "turn_failed", 500));
      terminateChild(child);
    }
  }

  onMessage(message) {
    if (message && Object.hasOwn(message, "id")) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        this.lastProtocolError = message.error;
        const missingHistory = pending.method === "thread/fork"
          && /no rollout found|thread.*(?:not found|does not exist|archived)|(?:not found|archived).*thread|no persisted history/i.test(message.error.message || "");
        pending.reject(missingHistory
          ? new BridgeError("The article's Codex history is unavailable.", "conversation_unavailable", 409)
          : turnError(message.error));
      }
      else pending.resolve(message.result);
      return;
    }

    const event = parseCodexEvent(message);
    if (!event?.threadId) return;
    const turn = this.turns.get(event.threadId);
    if (!turn || (event.turnId && turn.turnId && event.turnId !== turn.turnId)) return;
    if (turn.aborted && event.type !== "turn_started" && event.type !== "turn_completed") return;
    if (event.type === "turn_started") {
      turn.turnId = event.turnId || turn.turnId;
      if (!turn.started) {
        turn.started = true;
        turn.resolveStarted?.();
      }
      if (turn.aborted) void this.interrupt(turn);
    } else if (event.type === "message_started") {
      turn.messagePhases.set(event.itemId, event.phase);
    } else if (event.type === "delta") {
      if (turn.messagePhases.get(event.itemId) === "commentary") return;
      turn.turnId = event.turnId || turn.turnId;
      turn.rawText += event.text;
      try {
        const text = turn.citations.push(event.text);
        if (text) turn.onDelta(text);
      } catch (error) {
        turn.reject(error);
      }
    } else if (event.type === "completed_text") {
      if (event.phase === "commentary" || turn.messagePhases.get(event.itemId) === "commentary") return;
      turn.authoritativeText = event.text;
      if (event.text.startsWith(turn.rawText)) {
        const suffix = event.text.slice(turn.rawText.length);
        if (suffix) {
          turn.rawText += suffix;
          const text = turn.citations.push(suffix);
          if (text) turn.onDelta(text);
        }
      }
    } else if (event.type === "search") {
      turn.citations.add(event.sources);
      if (event.status === "searching") turn.searches.add(event.id);
      else turn.searches.delete(event.id);
      const { threadId: _threadId, turnId: _turnId, ...search } = event;
      turn.onSearch(search);
      const text = turn.citations.push("");
      if (text) turn.onDelta(text);
    } else if (event.type === "usage") {
      turn.usage = event.usage || turn.usage;
    } else if (event.type === "turn_completed") {
      this.turns.delete(event.threadId);
      if (event.status === "completed" && !event.error) {
        const tail = turn.citations.finish();
        if (tail) turn.onDelta(tail);
        turn.resolve({
          text: turn.citations.render(turn.authoritativeText || turn.rawText),
          usage: turn.usage,
          finishReason: "stop",
        });
      } else if (event.status === "interrupted" && turn.aborted) {
        turn.reject(abortError(turn.signal));
      } else {
        const failure = turnError(event.error || event.status);
        turn.reject(failure.code === "turn_failed" && (turn.searches.size || /search|web\.run/i.test(event.error?.message || ""))
          ? new BridgeError("Codex web search failed. Retry or check Web search in your Codex configuration.", "web_search_failed", 502)
          : failure);
      }
    }
  }

  onCrash(child, error) {
    if (child !== this.child) return;
    this.child = null;
    this.initialized = false;
    this.account = null;
    this.requiresOpenaiAuth = true;
    this.planType = null;
    const failure = error instanceof BridgeError
      ? error
      : new BridgeError(
        this.closed ? "Codex shut down." : "Codex stopped unexpectedly.",
        "turn_failed",
        500
      );
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(failure);
    }
    this.pending.clear();
    for (const turn of this.turns.values()) turn.reject(failure);
    this.turns.clear();
  }

  request(method, params = {}, {
    timeoutMs = REQUEST_TIMEOUT_MS,
    timeoutCode = "turn_failed",
  } = {}) {
    if (!this.child || this.child.stdin.destroyed) {
      return Promise.reject(new BridgeError("Codex is not ready.", "turn_failed", 500));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError(
          "Codex did not respond in time.",
          timeoutCode,
          timeoutCode === "agent_missing" ? 503 : 500
        ));
        terminateChild(this.child);
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.child.stdin.write(`${JSON.stringify({ method, id, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new BridgeError("Could not send a request to Codex.", "turn_failed", 500));
      });
    });
  }

  notify(method, params = {}) {
    if (this.child && !this.child.stdin.destroyed) {
      this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
    }
  }

  async refreshAccount() {
    const result = await this.request("account/read");
    this.account = result?.account || null;
    this.requiresOpenaiAuth = result?.requiresOpenaiAuth !== false;
    this.planType = result?.planType || this.account?.planType || null;
    return this.account;
  }

  async fetchModels() {
    const models = [];
    let cursor;
    do {
      const result = await this.request("model/list", {
        limit: 100,
        includeHidden: false,
        ...(cursor ? { cursor } : {}),
      });
      for (const model of result?.data || []) {
        if (model?.model && model.hidden !== true) models.push(codexModelEntry(model));
      }
      cursor = result?.nextCursor || null;
    } while (cursor);
    return models;
  }

  async interrupt(turn) {
    if (turn.interruptSent) return;
    turn.interruptSent = true;
    try {
      await turn.startedPromise;
      if (!turn.turnId || !this.child) return;
      await this.request("turn/interrupt", {
        threadId: turn.threadId,
        turnId: turn.turnId,
      });
    } catch {
      // Cancellation is already complete from the caller's perspective.
    }
  }

  executionMode({ model, effort, developerInstructions }) {
    if (!this.executeMode) {
      throw new BridgeError("Codex Execute mode is unavailable.", "turn_failed", 500);
    }
    return {
      mode: this.executeMode.mode,
      settings: {
        model,
        reasoning_effort: effort,
        developer_instructions: developerInstructions,
      },
    };
  }

  async historyScope() {
    if (!this.historyScopePromise) this.historyScopePromise = (async () => {
      const home = this.env.CODEX_HOME || path.join(this.env.HOME || os.homedir(), ".codex");
      await fs.mkdir(home, { recursive: true, mode: 0o700 });
      const filename = path.join(home, "rabbithole-history-scope");
      try { await fs.writeFile(filename, randomUUID() + "\n", { flag: "wx", mode: 0o600 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      const scopeId = (await fs.readFile(filename, "utf8")).trim();
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(scopeId)) throw new BridgeError("Codex history scope is invalid.", "turn_failed", 500);
      return scopeId;
    })().catch((error) => { this.historyScopePromise = null; throw error; });
    return this.historyScopePromise;
  }

  async releaseThread(threadId) {
    // Unsubscribe releases the live runtime after its idle period, preserving history.
    if (threadId && this.child && !this.closed) {
      await this.request("thread/unsubscribe", { threadId }).catch(() => {});
    }
  }

  async turn({
    model,
    input,
    instructions,
    reasoningEffort,
    signal,
    onDelta,
    onSearch = () => {},
    sourceSession = null,
  }) {
    const developerInstructions = instructions + egoBrowserInstructions(this.egoBrowser);

    const requestCwd = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-codex-turn-"));
    await fs.chmod(requestCwd, 0o700);
    let threadId;
    try {
      const scopeId = await this.historyScope();
      if (sourceSession && sourceSession.scopeId !== scopeId) {
        throw new BridgeError("The article belongs to another Codex history store.", "conversation_unavailable", 409);
      }
      if (signal?.aborted) throw abortError(signal);
      const fork = !!sourceSession;
      const threadResult = await this.request(fork ? "thread/fork" : "thread/start", {
        ...(fork ? { threadId: sourceSession.sessionId, excludeTurns: true } : { environments: [], dynamicTools: [], selectedCapabilityRoots: [] }),
        model,
        cwd: requestCwd,
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        ephemeral: false,
        developerInstructions: developerInstructions,
      });
      threadId = threadResult?.thread?.id;
      if (!threadId) {
        throw new BridgeError("Codex could not start the response.", "turn_failed", 500);
      }
      if (signal?.aborted) throw abortError(signal);
      const reference = { backend: "codex", sessionId: threadId, scopeId };

      let resolveTurn;
      let rejectTurn;
      let resolveStarted = () => {};
      const completion = new Promise((resolve, reject) => {
        resolveTurn = resolve;
        rejectTurn = reject;
      });
      // Abort/crash can reject before turn/start responds; keep rejection observed.
      void completion.catch(() => {});
      const startedPromise = new Promise((resolve) => {
        resolveStarted = () => resolve(undefined);
      });
      const turn = {
        threadId,
        turnId: null,
        signal,
        onDelta,
        onSearch,
        citations: new SearchCitations(),
        searches: new Set(),
        messagePhases: new Map(),
        rawText: "",
        authoritativeText: "",
        usage: undefined,
        resolve: resolveTurn,
        reject: rejectTurn,
        started: false,
        resolveStarted,
        startedPromise,
        aborted: false,
        interruptSent: false,
      };
      this.turns.set(threadId, turn);
      const onAbort = () => {
        turn.aborted = true;
        void this.interrupt(turn);
        rejectTurn(abortError(signal));
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        const response = await this.request("turn/start", {
          threadId,
          input: input,
          cwd: requestCwd,
          environments: [],
          approvalPolicy: "never",
          sandboxPolicy: {
            type: "dangerFullAccess",
          },
          model,
          effort: reasoningEffort,
          summary: "none",
          collaborationMode: this.executionMode({
            model,
            effort: reasoningEffort,
            developerInstructions: developerInstructions,
          }),
        });
        turn.turnId = response?.turn?.id || turn.turnId;
        turn.resolveStarted?.();
        if (turn.aborted) void this.interrupt(turn);
        const result = await completion;
        return { ...result, session: reference };
      } finally {
        turn.resolveStarted?.();
        signal?.removeEventListener("abort", onAbort);
        if (!turn.aborted) this.turns.delete(threadId);
      }
    } finally {
      await this.releaseThread(threadId);
      await fs.rm(requestCwd, { recursive: true, force: true });
    }
  }

  close() {
    this.closed = true;
    if (this.child) terminateChild(this.child);
    this.onCrash(this.child);
  }
}

export class CodexBackend {
  constructor({ executable, env, cwd, bridgeVersion }) {
    this.executable = executable;
    this.appServer = new CodexAppServer({
      executable,
      env,
      cwd,
      version: bridgeVersion,
    });
  }

  static async create({
    env = process.env,
    cwd,
    bridgeVersion,
  }) {
    return new CodexBackend({
      executable: resolveExecutable(
        "codex",
        env.RABBITHOLE_BRIDGE_CODEX_BIN,
        env
      ),
      env,
      cwd,
      bridgeVersion,
    });
  }

  initialState() {
    return startingAgent("codex", "Starting Codex");
  }

  warmup() {
    if (this.executable) void this.appServer.ensureStarted().catch(() => {});
  }

  async status() {
    if (!this.executable) return { installed: false, signedIn: false, plan: null };
    await this.appServer.ensureStarted();
    await this.appServer.refreshAccount();
    return {
      installed: true,
      signedIn: Boolean(this.appServer.account),
      requiresLogin: this.appServer.requiresOpenaiAuth && !this.appServer.account,
      plan: this.appServer.account
        ? this.appServer.planType || (this.appServer.account.type === "apiKey" ? "api_key" : "chatgpt")
        : null,
    };
  }

  async listModels() {
    const status = await this.status();
    if (status.requiresLogin ?? !status.signedIn) {
      throw new BridgeError(
        "Codex is signed out. Run `codex login` and try again.",
        "agent_signed_out",
        503
      );
    }
    const models = await this.appServer.fetchModels();
    if (!models.length) {
      throw new BridgeError("Codex returned an empty model list.", "turn_failed", 500);
    }
    return models;
  }

  async probe() {
    return probeAgent({
      name: "codex",
      executable: this.executable,
      installFix: INSTALL_FIX,
      loginFix: LOGIN_FIX,
      errorFix: "codex login",
      status: () => this.status(),
      models: () => this.appServer.fetchModels(),
    });
  }

  // The route (server.js handleChat) validates model, image capability, and
  // reasoning effort against the live catalog it fetches from this backend
  // immediately before calling generate — no re-validation here.
  async generate({ model, input, instructions, reasoningEffort, signal, onDelta = () => {}, onSearch = () => {}, sourceSession }) {
    if (signal?.aborted) throw abortError(signal);
    await this.appServer.ensureStarted();
    return this.appServer.turn({ model, input, instructions, reasoningEffort, signal, onDelta, onSearch, sourceSession });
  }

  close() {
    this.appServer.close();
  }
}
