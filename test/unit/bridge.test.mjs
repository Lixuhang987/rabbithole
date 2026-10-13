/** @protects bridge capability contracts. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  codexIsolationArgs,
  parseCodexEvent,
} from "../../src/node/bridge/agents/codex.js";
import { isAllowedOrigin } from "../../src/node/bridge/cors.js";
import { codexModelEntry } from "../../src/node/bridge/models.js";
import {
  BridgeStateStore,
  readyAgent,
  startingAgent,
  unavailableAgent,
} from "../../src/node/bridge/state.js";
import { readOrCreateBridgeToken, tokenMatches } from "../../src/node/bridge/token.js";

assert.equal(codexModelEntry({
  model: "vision",
  inputModalities: ["text", "image"],
}).images, true);
assert.equal(codexModelEntry({
  model: "text",
  inputModalities: ["text"],
}).images, false);
assert.deepEqual(parseCodexEvent({
  method: "turn/completed",
  params: {
    threadId: "thread",
    turn: { id: "turn", status: "completed", error: null },
  },
}), {
  type: "turn_completed",
  threadId: "thread",
  turnId: "turn",
  status: "completed",
  error: null,
});

for (const origin of [
  "https://rabbithole.ing",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
]) {
  assert.equal(isAllowedOrigin(origin), true);
}
for (const origin of [
  "https://www.rabbithole.ing",
  "https://localhost:3000",
  "http://localhost.evil.test:3000",
  "null",
]) {
  assert.equal(isAllowedOrigin(origin), false);
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-bridge-unit-"));
try {
  const env = {
    ...process.env,
    HOME: path.join(temporaryRoot, "home"),
    RABBITHOLE_DIR: path.join(temporaryRoot, "data"),
  };
  const first = await readOrCreateBridgeToken({ env });
  const second = await readOrCreateBridgeToken({ env });
  const third = await readOrCreateBridgeToken({ env, regenerate: true });
  assert.equal(first.token, second.token);
  assert.notEqual(first.token, third.token);
  assert.equal(tokenMatches(third.token, `Bearer ${third.token}`), true);
  assert.equal(tokenMatches(third.token, `Bearer ${third.token.slice(1)}`), false);
  assert.equal((await fs.stat(third.path)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.dirname(third.path))).mode & 0o777, 0o700);

  const overrides = codexIsolationArgs();
  assert.ok(overrides.includes('skills.include_instructions=false'));
  assert.ok(overrides.includes('orchestrator.mcp.enabled=false'));
  assert.ok(overrides.includes('sandbox_mode="danger-full-access"'));

  const model = {
    id: "codex/test",
    name: "Test",
    images: true,
    reasoning: { options: ["medium"], default: "medium" },
  };
  const ready = readyAgent("codex", { plan: "Pro", models: [model] });
  assert.equal(ready.state, "ready");
  assert.equal(ready.models.length, 1);
  assert.throws(() => readyAgent("codex", { models: [] }));
  assert.deepEqual(
    unavailableAgent("codex", "signed_out", "codex login"),
    { id: "codex", state: "signed_out", fix: "codex login" }
  );
  assert.deepEqual(
    startingAgent("claude", "Starting Claude Code"),
    { id: "claude", state: "starting", detail: "Starting Claude Code" }
  );

  let probeState = unavailableAgent("claude", "missing", "install");
  const store = new BridgeStateStore({
    version: "test",
    refreshMs: 60_000,
    backends: {
      claude: {
        initialState: () => startingAgent("claude", "Starting Claude Code"),
        probe: async () => probeState,
      },
      codex: {
        initialState: () => startingAgent("codex", "Starting Codex"),
        probe: async () => ready,
      },
    },
  });
  assert.deepEqual(store.value.agents, [
    { id: "claude", state: "starting", detail: "Starting Claude Code" },
    { id: "codex", state: "starting", detail: "Starting Codex" },
  ]);
  assert.equal(store.value.agents.some((agent) => Object.hasOwn(agent, "fix")), false);
  let changes = 0;
  store.subscribe(() => { changes += 1; });
  await store.refresh();
  assert.equal(changes, 1);
  await store.refresh();
  assert.equal(changes, 1);
  probeState = unavailableAgent("claude", "signed_out", "claude /login");
  await store.refresh();
  assert.equal(changes, 2);
  store.close();
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write("bridge unit ok\n");
