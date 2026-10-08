import { addressSpaceHint } from "./model-endpoint.js";
import { modelDescriptor } from "./model-descriptor.js";

export function bridgeRootUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
}

export const BRIDGE_COMMAND = "npx @shlokkhemani/rabbithole bridge";
export const BRIDGE_DOWN_HEADING = "Use your Claude or ChatGPT plan.";
export const BRIDGE_RECONNECT_INITIAL_MS = 1_000;
export const BRIDGE_RECONNECT_MAX_MS = 15_000;
export const BRIDGE_PING_INTERVAL_MS = 2_000;
export const BRIDGE_AGENT_COMMANDS = Object.freeze({
  claude: Object.freeze({
    login: "claude /login",
    install: "npm install -g @anthropic-ai/claude-code",
  }),
  codex: Object.freeze({
    login: "codex login",
    install: "npm install -g @openai/codex",
  }),
});
export const BRIDGE_AGENT_LABELS = Object.freeze({ claude: "Claude Code", codex: "Codex" });

export function nextBridgeReconnectDelay(currentDelay = 0) {
  const current = Number(currentDelay) || 0;
  return current > 0
    ? Math.min(current * 2, BRIDGE_RECONNECT_MAX_MS)
    : BRIDGE_RECONNECT_INITIAL_MS;
}

/*
 * Pre-pairing liveness. An unpaired page cannot read any authed bridge
 * response — the 401 carries no CORS header, so it rejects exactly like
 * "no bridge at all". /bridge/ping is the one unauthenticated route, and it
 * lets the setup panel advance its instructions the moment the user runs
 * the command instead of asking them to guess whether anything happened.
 */
export async function pingBridge(baseUrl, { timeoutMs = 1_500 } = {}) {
  const url = `${bridgeRootUrl(baseUrl)}/bridge/ping`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, ...addressSpaceHint(url) });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Restart CLI backends while preserving the paired HTTP listener. */
export async function restartBridge(baseUrl, bearerToken) {
  const url = `${bridgeRootUrl(baseUrl)}/bridge/restart`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${String(bearerToken || "")}` },
    body: "{}",
    signal: AbortSignal.timeout(60_000),
    ...addressSpaceHint(url),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `Restart failed (HTTP ${response.status}).`);
  return payload.state;
}

/*
 * The bridge prints one pairing link; people paste whatever their terminal
 * lets them grab — the whole link, the fragment, or just the token. Accept
 * all of them rather than teaching the difference.
 */
export function pairingFromInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.includes("bridge=")) {
    const hashIndex = raw.indexOf("#");
    const params = new URLSearchParams(hashIndex === -1 ? raw : raw.slice(hashIndex + 1));
    const token = (params.get("bridge") || "").trim();
    if (!token) return null;
    const port = Number(params.get("bridge_port") || "");
    return { token, ...(Number.isInteger(port) && port > 0 && port <= 65535 ? { port } : {}) };
  }
  if (/\s/.test(raw)) return null;
  return { token: raw };
}

/** @param {string} baseUrl @param {string} bearerToken @param {{signal?: AbortSignal, onState?: (state: any) => void}} [options] */
export async function consumeBridgeEvents(baseUrl, bearerToken, { signal, onState = () => {} } = {}) {
  const url = `${bridgeRootUrl(baseUrl)}/bridge/events`;
  const response = await fetch(url, {
    headers: {
      Accept: "text/event-stream",
      Authorization: `Bearer ${String(bearerToken || "")}`,
    },
    signal,
    ...addressSpaceHint(url),
  });
  if (response.status === 401) return { reason: "unauthorized" };
  if (!response.ok) throw new Error(`The bridge returned HTTP ${response.status}.`);
  if (!response.body) throw new Error("The bridge did not return a state stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = drainBridgeFrames(buffer, onState);
    }
    buffer += decoder.decode();
    if (buffer.trim()) parseBridgeFrame(buffer, onState);
    return { reason: "closed" };
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function drainBridgeFrames(buffer, onState) {
  let boundary = /\r?\n\r?\n/.exec(buffer);
  while (boundary) {
    parseBridgeFrame(buffer.slice(0, boundary.index), onState);
    buffer = buffer.slice(boundary.index + boundary[0].length);
    boundary = /\r?\n\r?\n/.exec(buffer);
  }
  return buffer;
}

/** @param {string} frame @param {(state: any) => void} [onState] */
export function parseBridgeFrame(frame, onState = () => {}) {
  const data = String(frame || "").split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return null;
  const state = normalizeBridgeState(JSON.parse(data));
  onState(state);
  return state;
}

export function normalizeBridgeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.agents)) {
    throw new Error("The bridge sent an invalid state.");
  }
  const agents = value.agents.map(normalizeAgent).filter(Boolean);
  if (!agents.length) throw new Error("The bridge state has no agents.");
  return {
    bridge: typeof value.bridge === "string" ? value.bridge : "",
    agents,
  };
}

function normalizeAgent(agent) {
  if (!agent || (agent.id !== "claude" && agent.id !== "codex")) return null;
  const state = ["starting", "missing", "signed_out", "ready", "error"].includes(agent.state)
    ? agent.state
    : "error";
  const models = Array.isArray(agent.models)
    ? agent.models.filter((model) => model && typeof model.id === "string" && model.id).map((model) => ({
      ...modelDescriptor({
      id: model.id,
      name: typeof model.name === "string" && model.name ? model.name : visibleBridgeModelId(model.id),
      reasoning: normalizeReasoning(model.reasoning),
      vision: model.images === true,
      }),
      agent: agent.id,
    }))
    : [];
  const normalizedState = state === "ready" && !models.length ? "error" : state;
  return {
    id: agent.id,
    state: normalizedState,
    ...(typeof agent.plan === "string" && agent.plan ? { plan: agent.plan } : {}),
    ...(normalizedState === "ready" ? { models } : {}),
    ...(normalizedState !== "starting" && normalizedState !== "ready"
      ? {
        fix: typeof agent.fix === "string" && agent.fix ? agent.fix : BRIDGE_COMMAND,
        ...(typeof agent.detail === "string" && agent.detail ? { detail: agent.detail } : {}),
      }
      : {}),
  };
}

export function bridgeStateKey(state) {
  return JSON.stringify(state || null);
}

export function bridgeAgent(state, agentId) {
  return state?.agents?.find((agent) => agent.id === agentId) || null;
}

export function bridgeModelsForAgent(state, agentId) {
  const agent = bridgeAgent(state, agentId);
  return agent?.state === "ready" ? agent.models : [];
}

export function bridgeAgentOf(modelId) {
  const id = String(modelId || "");
  if (id.startsWith("claude/")) return "claude";
  if (id.startsWith("codex/")) return "codex";
  return "";
}

function visibleBridgeModelId(modelId) {
  const id = String(modelId || "");
  return bridgeAgentOf(id) ? id.slice(id.indexOf("/") + 1) : id;
}

const REASONING_LABELS = Object.freeze({
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "X-High",
  max: "Max",
  ultra: "Ultra",
});

export function reasoningLabel(value) {
  const key = String(value || "");
  return REASONING_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1) : "");
}

function normalizeReasoning(value) {
  const options = Array.isArray(value?.options)
    ? value.options.filter((entry) => typeof entry === "string" && entry)
    : [];
  const defaultOption = options.includes("medium") ? "medium" : options[0] || "";
  const preferred = typeof value?.default === "string" && options.includes(value.default)
    ? value.default
    : defaultOption;
  return { options, default: preferred };
}

export function planLabel(plan) {
  const value = String(plan || "").trim();
  if (!value) return "";
  const key = value.toLowerCase();
  const hidden = new Set(["chatgpt", "api_key"]);
  if (hidden.has(key)) return "";
  const known = {
    max: "Max",
    pro: "Pro",
    plus: "Plus",
    free: "Free",
    team: "Team",
    business: "Business",
    enterprise: "Enterprise",
  };
  return known[key] || reasoningLabel(value);
}
