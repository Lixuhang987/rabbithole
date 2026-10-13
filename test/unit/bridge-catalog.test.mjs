/** @protects bridge catalog capability contracts. */
import assert from "node:assert/strict";
import {
  BRIDGE_AGENT_COMMANDS,
  BRIDGE_RECONNECT_INITIAL_MS,
  BRIDGE_RECONNECT_MAX_MS,
  bridgeAgent,
  bridgeModelsForAgent,
  bridgeRootUrl,
  consumeBridgeEvents,
  normalizeBridgeState,
  nextBridgeReconnectDelay,
  parseBridgeFrame,
  planLabel,
  reasoningLabel,
} from "../../src/web/provider/bridge-catalog.js";

assert.equal(bridgeRootUrl("http://127.0.0.1:41414"), "http://127.0.0.1:41414");
assert.equal(bridgeRootUrl("http://127.0.0.1:41414/"), "http://127.0.0.1:41414");
assert.equal(bridgeRootUrl("http://127.0.0.1:41414"), "http://127.0.0.1:41414");


assert.equal(planLabel("max"), "Max");
assert.equal(planLabel("pro"), "Pro");
assert.equal(planLabel("plus"), "Plus");
assert.equal(planLabel("chatgpt"), "", "the generic product value is not an account tier");
assert.equal(planLabel("api_key"), "", "an auth kind is not an account tier");
assert.equal(planLabel("future-machine-value"), "Future-machine-value", "unknown real tiers use the reasoning-label fallback");
assert.equal(planLabel(""), "");
assert.equal(reasoningLabel("xhigh"), "X-High");
assert.equal(reasoningLabel("ultra"), "Ultra");
assert.equal(BRIDGE_AGENT_COMMANDS.codex.install, "npm install -g @openai/codex");
const reconnectDelays = [];
for (let delay = 0; reconnectDelays.length < 7;) {
  delay = nextBridgeReconnectDelay(delay);
  reconnectDelays.push(delay);
}
assert.deepEqual(reconnectDelays, [1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000]);
assert.equal(BRIDGE_RECONNECT_INITIAL_MS, 1_000);
assert.equal(BRIDGE_RECONNECT_MAX_MS, 15_000);

const stateCases = [
  { state: "starting" },
  { state: "missing", fix: "install codex" },
  { state: "signed_out", fix: "codex /login" },
  {
    state: "ready",
    plan: "Max",
    models: [{
      id: "codex/gpt-test",
      name: "Sonnet",
      images: true,
      reasoning: { options: ["low", "medium", "future"], default: "future" },
    }],
  },
  { state: "error", fix: "codex --version", detail: "Discovery failed" },
];
for (const expected of stateCases) {
  const normalized = normalizeBridgeState({
    bridge: "0.4.0",
    agents: [{ id: "codex", ...expected }],
  });
  assert.equal(bridgeAgent(normalized, "codex").state, expected.state);
}

const ready = normalizeBridgeState({
  bridge: "0.4.0",
  agents: [
    {
      id: "codex",
      state: "ready",
      plan: "Max",
      models: [{
        id: "codex/gpt-test",
        name: "Sonnet",
        images: true,
        reasoning: { options: ["low", "medium", "future"], default: "future" },
      }],
    },
  ],
});
assert.deepEqual(bridgeModelsForAgent(ready, "codex")[0], {
  id: "codex/gpt-test",
  name: "Sonnet",
  agent: "codex",
  vision: true,
  reasoning: { options: ["low", "medium", "future"], default: "future" },
});
assert.equal(bridgeAgent(normalizeBridgeState({
  bridge: "0.4.0",
  agents: [{ id: "codex", state: "ready", models: [] }],
}), "codex").state, "error", "ready with an empty catalog is represented as error");
assert.equal(parseBridgeFrame(":heartbeat\n\n"), null);

const realFetch = globalThis.fetch;
try {
  const encoder = new TextEncoder();
  let request = /** @type {any} */ (null);
  (/** @type {any} */ (globalThis)).fetch = async (url, options) => {
    request = { url: String(url), options };
    const payload = `data: ${JSON.stringify(ready)}\n\n:heartbeat\n\n`;
    return {
      status: 200,
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(payload.slice(0, 31)));
          controller.enqueue(encoder.encode(payload.slice(31)));
          controller.close();
        },
      }),
    };
  };
  const frames = [];
  const result = await consumeBridgeEvents("http://127.0.0.1:41414", "paired-token", {
    onState: (state) => frames.push(state),
  });
  assert.equal(result.reason, "closed");
  assert.equal(request.url, "http://127.0.0.1:41414/bridge/events");
  assert.equal(request.options.headers.Authorization, "Bearer paired-token");
  assert.equal(frames.length, 1);
  assert.equal(bridgeAgent(frames[0], "codex").models[0].id, "codex/gpt-test");

  (/** @type {any} */ (globalThis)).fetch = async () => ({ status: 401, ok: false });
  assert.deepEqual(
    await consumeBridgeEvents("http://127.0.0.1:41414", "old-token"),
    { reason: "unauthorized" },
  );
} finally {
  globalThis.fetch = realFetch;
}

/* Pairing input takes whatever the terminal let the user grab. */
const { pairingFromInput } = await import("../../src/web/provider/bridge-catalog.js");
const hex = "a".repeat(64);
assert.deepEqual(pairingFromInput(`https://rabbithole.ing/#bridge=${hex}`), { token: hex });
assert.deepEqual(pairingFromInput(`  https://rabbithole.ing/#bridge=${hex}&bridge_port=41500 `), { token: hex, port: 41500 });
assert.deepEqual(pairingFromInput(`#bridge=${hex}`), { token: hex });
assert.deepEqual(pairingFromInput(`bridge=${hex}&bridge_port=99999`), { token: hex }, "an out-of-range port is dropped, not trusted");
assert.deepEqual(pairingFromInput(hex), { token: hex });
assert.equal(pairingFromInput("https://rabbithole.ing/#bridge="), null);
assert.equal(pairingFromInput("   "), null);
assert.equal(pairingFromInput("two words"), null);

/* The ping probe answers up/down and never throws. */
const pingFetch = globalThis.fetch;
try {
  const { pingBridge } = await import("../../src/web/provider/bridge-catalog.js");
  let pingUrl = "";
  (/** @type {any} */ (globalThis)).fetch = async (url) => { pingUrl = url; return { ok: true }; };
  assert.equal(await pingBridge("http://127.0.0.1:41414"), true);
  assert.equal(pingUrl, "http://127.0.0.1:41414/bridge/ping");
  (/** @type {any} */ (globalThis)).fetch = async () => { throw new TypeError("Failed to fetch"); };
  assert.equal(await pingBridge("http://127.0.0.1:41414"), false);
  (/** @type {any} */ (globalThis)).fetch = async () => ({ ok: false, status: 403 });
  assert.equal(await pingBridge("http://127.0.0.1:41414"), false);
} finally {
  globalThis.fetch = pingFetch;
}

process.stdout.write("bridge-catalog SSE state machine ok\n");
