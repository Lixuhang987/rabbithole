/** @protects long subscribed answers complete while cancellation remains explicit. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBridge } from "../../src/node/bridge/server.js";
import { createProvider } from "../../src/web/provider/openai-compatible.js";

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
      RABBITHOLE_BRIDGE_CLAUDE_BIN: fixture("claude"),
      RABBITHOLE_BRIDGE_CODEX_BIN: fixture("codex"),
    },
    stateRefreshMs: 60_000,
  });
  await bridge.start();
  await bridge.refreshState();

  // Compress the former five-minute boundary; leave startup and RPC timers real.
  // Both external agent fixtures finish after 250ms, beyond that boundary.
  globalThis.setTimeout = Object.assign(
    (callback, delay, ...args) => originalSetTimeout(callback, delay === 300_000 ? 100 : delay, ...args),
    originalSetTimeout,
  );
  for (const model of ["codex/gpt-fake", "claude/sonnet"]) {
    const provider = createProvider({ preset: "subscriptions", base_url: `${bridge.url}/v1`, model }, bridge.token);
    const events = [];
    for await (const event of provider.authorExplainer({ question: "LONG_RESPONSE", nodeId: "long-answer" })) events.push(event);
    assert.equal(events.filter((event) => event.type === "text").map((event) => event.delta).join(""), "OK", model);
    if (model.startsWith("codex/")) assert.ok(events.some((event) => event.type === "conversation"), "long Codex answer must commit its conversation");
  }
  process.stdout.write("long answers complete for Codex and Claude\n");
} finally {
  globalThis.setTimeout = originalSetTimeout;
  await bridge?.close();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
