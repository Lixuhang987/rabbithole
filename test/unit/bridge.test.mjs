/** @protects bridge capability contracts. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseClaudeEvent } from "../../src/node/bridge/claude.js";
import {
  codexIsolationArgs,
  parseCodexEvent,
} from "../../src/node/bridge/codex.js";
import { isAllowedOrigin } from "../../src/node/bridge/cors.js";
import {
  buildClaudeInput,
  buildCodexInput,
  countImageParts,
  joinSystemMessages,
  serializeTranscript,
} from "../../src/node/bridge/messages.js";
import {
  claudeAliasDisplayName,
  codexModelEntry,
  parseClaudeAliases,
  routeModelId,
} from "../../src/node/bridge/models.js";
import {
  BridgeStateStore,
  readyAgent,
  startingAgent,
  unavailableAgent,
} from "../../src/node/bridge/state.js";
import { readOrCreateBridgeToken, tokenMatches } from "../../src/node/bridge/token.js";

const messages = [
  { role: "system", content: "First rule." },
  { role: "user", content: "Hello" },
  { role: "assistant", content: [{ type: "text", text: "Hi" }] },
  {
    role: "user",
    content: [
      { type: "text", text: "What color?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
      { type: "image_url", image_url: { url: "https://example.test/image.png" } },
    ],
  },
];

assert.equal(joinSystemMessages(messages), "First rule.");
assert.equal(
  serializeTranscript(messages),
  "Conversation transcript:\n<user>Hello</user>\n<assistant>Hi</assistant>\n<user>What color?</user>"
);
assert.equal(countImageParts(messages), 2);
const claudeInput = buildClaudeInput(messages);
assert.equal(claudeInput.imageCount, 1);
assert.equal(claudeInput.imagePartCount, 2);
assert.deepEqual(claudeInput.input.message.content[1], {
  type: "image",
  source: { type: "base64", media_type: "image/png", data: "AQID" },
});
const codexInput = buildCodexInput(messages);
assert.equal(codexInput.imageCount, 1);
assert.equal(codexInput.imagePartCount, 2);
assert.deepEqual(codexInput.input[1], {
  type: "image",
  url: "data:image/png;base64,AQID",
  detail: "auto",
});

assert.equal(codexModelEntry({
  model: "vision",
  inputModalities: ["text", "image"],
}).images, true);
assert.equal(codexModelEntry({
  model: "text",
  inputModalities: ["text"],
}).images, false);
assert.deepEqual(routeModelId("claude/sonnet"), { backend: "claude", model: "sonnet" });
assert.deepEqual(routeModelId("codex/gpt-5"), { backend: "codex", model: "gpt-5" });
assert.equal(routeModelId("gpt-5"), null);

const claudeModelFixture = await fs.readFile(
  new URL("./fixtures/claude-model-output.txt", import.meta.url),
  "utf8"
);
const aliases = parseClaudeAliases({ result: claudeModelFixture });
/* Deep-equal the FULL list so any future silent filtering fails here. `opusplan` is a distinct
   routing mode and must survive; a first implementation dropped it as "redundant". */
assert.deepEqual(aliases, [
  "sonnet",
  "opus",
  "haiku",
  "fable",
  "sonnet[1m]",
  "opus[1m]",
  "fable[1m]",
  "opusplan",
]);
assert.deepEqual(
  parseClaudeAliases("Available: sonnet, token with whitespace, opus[1m]"),
  ["sonnet", "opus[1m]"]
);
/* `best` and `default` are the ONLY filtered aliases — an unknown alias must pass through. */
assert.deepEqual(
  parseClaudeAliases("Available: best, newmodel, default, opusplan, or a full model ID."),
  ["newmodel", "opusplan"]
);
/* No version numbers: the label is derived from the alias, not a table. */
assert.equal(claudeAliasDisplayName("opus[1m]"), "Opus · 1M context");
assert.equal(claudeAliasDisplayName("sonnet"), "Sonnet");
assert.equal(claudeAliasDisplayName("newmodel"), "Newmodel");

assert.deepEqual(parseClaudeEvent({
  type: "system",
  subtype: "init",
  tools: [],
  mcp_servers: [],
}), { type: "init", tools: [], mcpServers: [] });
assert.deepEqual(parseClaudeEvent({
  type: "stream_event",
  event: {
    type: "content_block_delta",
    delta: { type: "text_delta", text: "OK" },
  },
}), { type: "delta", text: "OK" });
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
