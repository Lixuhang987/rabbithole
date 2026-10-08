/** @protects bridge failure modes capability contracts. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProvider } from "../../src/web/provider/openai-compatible.js";
import { createBridge } from "../../src/node/bridge/server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FAKE_CLAUDE = path.join(ROOT, "test/integration/fixtures/fake-claude.mjs");
const FAKE_CODEX = path.join(ROOT, "test/integration/fixtures/fake-codex.mjs");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-bridge-failures-"));
const home = path.join(temporaryRoot, "home");
const data = path.join(temporaryRoot, "data");
const concurrencyRecord = path.join(temporaryRoot, "codex-concurrency.txt");
const claudeKilledRecord = path.join(temporaryRoot, "claude-killed.txt");
await fs.mkdir(path.join(home, ".codex"), { recursive: true });
await fs.writeFile(path.join(home, ".codex", "auth.json"), "{}\n");

function bridgeEnv(extra = {}) {
  return {
    ...process.env,
    HOME: home,
    RABBITHOLE_DIR: data,
    RABBITHOLE_BRIDGE_CLAUDE_BIN: FAKE_CLAUDE,
    RABBITHOLE_BRIDGE_CODEX_BIN: FAKE_CODEX,
    FAKE_CODEX_CONCURRENCY: concurrencyRecord,
    FAKE_CLAUDE_KILLED: claudeKilledRecord,
    ...extra,
  };
}

function headers(bridge, body) {
  return {
    Authorization: `Bearer ${bridge.token}`,
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
  };
}

async function chat(bridge, payload) {
  const body = JSON.stringify(payload);
  const response = await fetch(`${bridge.url}/v1/chat/completions`, {
    method: "POST",
    headers: headers(bridge, body),
    body,
  });
  const raw = await response.text();
  assert.ok(raw.length > 0, "bridge response capture must contain a body");
  return { status: response.status, raw, json: JSON.parse(raw) };
}

function startChat(bridge, payload, signal) {
  const body = JSON.stringify(payload);
  return fetch(`${bridge.url}/v1/chat/completions`, {
    method: "POST",
    headers: headers(bridge, body),
    body,
    signal,
  });
}

async function waitForFile(file, predicate, label) {
  const deadline = Date.now() + 5_000;
  let value = "";
  while (Date.now() < deadline) {
    value = await fs.readFile(file, "utf8").catch(() => "");
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}

async function firstSseState(bridge) {
  const controller = new AbortController();
  const response = await fetch(`${bridge.url}/bridge/events`, {
    headers: { Authorization: `Bearer ${bridge.token}` },
    signal: controller.signal,
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  while (!raw.includes("\n\n")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    raw += decoder.decode(chunk.value, { stream: true });
  }
  controller.abort();
  assert.match(raw, /^data: /, "SSE capture must contain the initial bridge state");
  return JSON.parse(raw.split(/\r?\n/).find((line) => line.startsWith("data: ")).slice(6));
}

let bridge;
let signedOutBridge;
let earlyExitBridge;
try {
  bridge = await createBridge({
    port: 0,
    env: bridgeEnv(),
    version: "0.4.0-test",
    stateRefreshMs: 60_000,
  });
  await bridge.start();
  await bridge.refreshState();

  const signedOut = await chat(bridge, {
    model: "claude/sonnet",
    messages: [{ role: "user", content: "SIGNED_OUT" }],
    stream: false,
  });
  assert.equal(signedOut.status, 503);
  assert.equal(signedOut.json.error.code, "agent_signed_out");
  assert.match(signedOut.json.error.message, /signed out/i);

  const rawFailure = await chat(bridge, {
    model: "claude/sonnet",
    messages: [{ role: "user", content: "RAW_FAILURE" }],
    stream: false,
  });
  assert.equal(rawFailure.status, 500);
  assert.equal(rawFailure.json.error.code, "turn_failed");
  assert.equal(rawFailure.raw.includes("/Users/private/secret.js"), false);

  const oversized = await chat(bridge, {
    model: "claude/sonnet",
    messages: [{ role: "user", content: "OVERSIZED_LINE" }],
    stream: false,
  });
  assert.equal(oversized.status, 500);
  assert.equal(oversized.json.error.code, "turn_failed");
  assert.match(oversized.json.error.message, /oversized response/i);

  const claudeAbort = new AbortController();
  const slowClaudeResponse = await startChat(bridge, {
    model: "claude/sonnet",
    messages: [{ role: "user", content: "SLOW" }],
    stream: true,
  }, claudeAbort.signal);
  assert.equal(slowClaudeResponse.status, 200);
  const slowClaudeChunk = await slowClaudeResponse.body.getReader().read();
  const slowClaudeText = new TextDecoder().decode(slowClaudeChunk.value);
  assert.match(slowClaudeText, /working/, "Claude slow-stream capture must receive a real delta");
  claudeAbort.abort();
  await waitForFile(claudeKilledRecord, (value) => value === "SIGTERM\n", "Claude child was not terminated");

  const searchProvider = createProvider({ preset: "subscriptions", base_url: `${bridge.url}/v1`, model: "codex/gpt-fake", web_search: "auto" }, bridge.token);
  const searchStatus = [];
  await assert.rejects(async () => {
    for await (const event of searchProvider.authorExplainer({ question: "SEARCH FAIL" })) searchStatus.push(event);
  }, (/** @type {any} */ error) => error.code === "web_search_failed" && /Codex configuration/.test(error.message));
  assert.deepEqual(searchStatus.map((event) => event.status), ["searching"]);
  const searchAbort = new AbortController();
  const searchStream = searchProvider.authorExplainer({ question: "SEARCH SLOW" }, searchAbort.signal);
  assert.equal((await searchStream.next()).value.status, "searching");
  searchAbort.abort();
  await assert.rejects(() => searchStream.next(), (/** @type {any} */ error) => error.code === "abort");
  await searchStream.return();

  const codexAbort = new AbortController();
  const slowCodex = startChat(bridge, {
    model: "codex/gpt-fake",
    messages: [{ role: "user", content: "SLOW" }],
    stream: true,
  }, codexAbort.signal);
  slowCodex.catch(() => {});
  await waitForFile(concurrencyRecord, (value) => Number(value.trim()) >= 1, "Codex slow turn did not start");
  const restartWhileBusy = await fetch(`${bridge.url}/bridge/restart`, {
    method: "POST", headers: { Authorization: `Bearer ${bridge.token}`, "Content-Type": "application/json" }, body: "{}",
  });
  assert.equal(restartWhileBusy.status, 409);
  assert.equal((await restartWhileBusy.json()).error.code, "bridge_busy");
  const concurrent = await chat(bridge, {
    model: "codex/gpt-fake",
    messages: [{ role: "user", content: "concurrent turn" }],
    stream: false,
  });
  assert.equal(concurrent.status, 200);
  const maxActive = Number((await waitForFile(
    concurrencyRecord,
    (value) => Number(value.trim()) === 2,
    "Codex turns did not overlap"
  )).trim());
  assert.equal(maxActive, 2, "Codex concurrency recorder must observe both live turns");
  codexAbort.abort();
  await assert.rejects(slowCodex, (/** @type {any} */ error) => error?.name === "AbortError");

  signedOutBridge = await createBridge({
    port: 0,
    env: bridgeEnv({
      RABBITHOLE_DIR: path.join(temporaryRoot, "signed-out-data"),
      FAKE_CLAUDE_SIGNED_OUT: "1",
      FAKE_CODEX_SIGNED_OUT: "1",
    }),
    version: "0.4.0-test",
    stateRefreshMs: 60_000,
  });
  await signedOutBridge.start();
  await signedOutBridge.refreshState();
  const signedOutState = await firstSseState(signedOutBridge);
  assert.equal(signedOutState.agents.length, 2);
  const claudeState = signedOutState.agents.find((agent) => agent.id === "claude");
  const codexState = signedOutState.agents.find((agent) => agent.id === "codex");
  assert.equal(claudeState.state, "signed_out");
  assert.equal(claudeState.fix, "claude /login");
  assert.equal(codexState.state, "signed_out");
  assert.equal(codexState.fix, "codex login");

  earlyExitBridge = await createBridge({
    port: 0,
    env: bridgeEnv({
      RABBITHOLE_DIR: path.join(temporaryRoot, "early-exit-data"),
      FAKE_CLAUDE_EXIT_BEFORE_STDIN: "1",
    }),
    version: "0.4.0-test",
    stateRefreshMs: 60_000,
  });
  await earlyExitBridge.start();
  await earlyExitBridge.refreshState();
  const earlyExit = await chat(earlyExitBridge, {
    model: "claude/sonnet",
    messages: [{ role: "user", content: "ordinary turn" }],
    stream: false,
  });
  assert.equal(earlyExit.status, 500);
  assert.equal(earlyExit.json.error.code, "turn_failed");

  process.stdout.write(
    "bridge failure modes "
    + "signed_out_midstream=agent_signed_out raw_failure=turn_failed "
    + "oversized_line=turn_failed claude_slow_cancel=SIGTERM "
    + `concurrent_turns=${maxActive} codex_slow_cancel=interrupted `
    + `signed_out_state=${claudeState.state},${codexState.state} `
    + `exit_before_stdin=${earlyExit.json.error.code}\n`
  );
} finally {
  await Promise.allSettled([earlyExitBridge?.close(), signedOutBridge?.close(), bridge?.close()]);
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
