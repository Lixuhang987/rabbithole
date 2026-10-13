/** @protects long subscribed answers complete while cancellation remains explicit. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBridge } from "../../src/node/bridge/server.js";
import { createProvider } from "../../src/web/provider/bridge-provider.js";

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-long-answer-"));
const fixture = (name) => path.resolve(new URL(`./fixtures/fake-${name}.mjs`, import.meta.url).pathname);
const originalSetTimeout = globalThis.setTimeout;
let bridge;
try {
  const home = path.join(temporaryRoot, "home");
  await fs.mkdir(path.join(home, ".codex"), { recursive: true });
  await fs.writeFile(path.join(home, ".codex", "auth.json"), "{}\n");
  bridge = await createBridge({
    port: 0,
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: undefined,
      RABBITHOLE_DIR: path.join(temporaryRoot, "data"),
      RABBITHOLE_BRIDGE_EGO_BIN: fixture("ego-browser"),
      RABBITHOLE_BRIDGE_CODEX_BIN: fixture("codex"),
    },
    stateRefreshMs: 60_000,
  });
  await bridge.start();
  await bridge.refreshState();

  // Compress the former five-minute boundary; leave startup and RPC timers real.
  // The external Codex fixture finishes after 250ms, beyond that boundary.
  globalThis.setTimeout = Object.assign(
    (callback, delay, ...args) => originalSetTimeout(callback, delay === 300_000 ? 100 : delay, ...args),
    originalSetTimeout,
  );
  const provider = createProvider({ backend: "codex", base_url: bridge.url,
    model: "gpt-fake", reasoning: "medium", token: bridge.token });
  const events = [];
  for await (const event of provider.authorExplainer({ question: "LONG_RESPONSE", nodeId: "long-answer" })) events.push(event);
  assert.equal(events.filter((event) => event.type === "text").map((event) => event.delta).join(""), "OK");
  assert.ok(events.some((event) => event.type === "conversation"), "long Codex answer must commit its session");
  process.stdout.write("long Codex answers complete without a generation deadline\n");
} finally {
  globalThis.setTimeout = originalSetTimeout;
  await bridge?.close();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
