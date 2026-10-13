/** @protects codex isolation capability contracts. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  CodexAppServer,
  codexIsolationArgs,
} from "../../src/node/bridge/agents/codex.js";
import { resolveExecutable } from "../../src/node/bridge/agents/isolation.js";
import { assertNoDeletedSubscriptionMechanisms } from "../support/subscription-source-guard.mjs";

const execFileAsync = promisify(execFile);
await assertNoDeletedSubscriptionMechanisms();
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-codex-isolation-"));
const home = path.join(temporaryRoot, "home");
const data = path.join(temporaryRoot, "data");
const cwd = path.join(temporaryRoot, "cwd");
const egoSkill = path.join(home, ".agents/skills/ego-browser/SKILL.md");
const egoExecutable = fileURLToPath(new URL("../integration/fixtures/fake-ego-browser.mjs", import.meta.url));
await fs.mkdir(path.join(home, ".codex"), { recursive: true, mode: 0o700 });
await fs.mkdir(cwd, { mode: 0o700 });

let resolveCaptured;
let rejectCaptured;
const captured = new Promise((resolve, reject) => {
  resolveCaptured = resolve;
  rejectCaptured = reject;
});
const providerRequests = [];
const providerHeaders = [];
const searchRequests = [];
let searchResponses = 0;
const stub = http.createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    if (raw) {
      try {
        const body = JSON.parse(raw);
        if (req.url.endsWith("/alpha/search")) {
          searchRequests.push({ body, authorization: req.headers.authorization });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ output: "Result [turn0search0]: https://example.com/result", results: [{ type: "text_result", ref_id: "turn0search0", url: "https://example.com/result", title: "Example" }] }));
          return;
        }
        providerRequests.push(body);
        providerHeaders.push(req.headers);
        if (JSON.stringify(body.input).includes("EGO-CHECK")) {
          const received = JSON.stringify(body.input).includes("EGO_TOOL_ROUNDTRIP");
          const item = received
            ? { type: "message", id: "msg-ego", role: "assistant", content: [{ type: "output_text", text: "Browser verified." }] }
            : { type: "function_call", call_id: "ego-call", namespace: "mcp__rabbithole_ego_browser", name: "ego_browser", arguments: JSON.stringify({ action: "run", script: "console.log('EGO_TOOL_ROUNDTRIP')" }) };
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          for (const event of [
            { type: "response.created", response: { id: `resp-ego-${providerRequests.length}` } },
            { type: "response.output_item.done", item },
            { type: "response.completed", response: { id: `resp-ego-${providerRequests.length}`, status: "completed", output: [] } },
          ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          res.end();
          return;
        }
        if (JSON.stringify(body.input).includes("FORK-CHECK")) {
          const item = { type: "message", id: "msg-fork", role: "assistant", content: [{ type: "output_text", text: "Fork verified." }] };
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          for (const event of [
            { type: "response.created", response: { id: "resp-fork" } },
            { type: "response.output_item.done", item },
            { type: "response.completed", response: { id: "resp-fork", status: "completed", output: [] } },
          ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          res.end();
          return;
        }
        if (body.tools?.some((tool) => tool.type === "namespace" && tool.name === "web")) {
          const n = ++searchResponses;
          const item = n === 1
            ? { type: "function_call", call_id: "search-live-1", namespace: "web", name: "run", arguments: JSON.stringify({ search_query: [{ q: "offline search" }] }) }
            : { type: "message", id: "msg-final", role: "assistant", content: [{ type: "output_text", text: "Found citeturn0search0." }] };
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          for (const event of [
            { type: "response.created", response: { id: `resp-${n}` } },
            { type: "response.output_item.done", item },
            { type: "response.completed", response: { id: `resp-${n}`, status: "completed", output: [] } },
          ]) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          res.end();
          return;
        }
        resolveCaptured(body);
      } catch (error) {
        rejectCaptured(error);
      }
    }
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end('{"error":{"message":"offline isolation capture complete"}}');
  });
});
await new Promise((resolve, reject) => {
  stub.once("error", reject);
  stub.listen({ port: 0, host: "127.0.0.1" }, () => resolve());
});
const stubPort = stub.address().port;
const providerConfig = [
  'model = "rabbithole-isolation-model"',
  'model_provider = "rabbithole_test"',
  "",
  "[model_providers.rabbithole_test]",
  'name = "Rabbithole isolation test"',
  `base_url = "http://127.0.0.1:${stubPort}/v1"`,
  'env_key = "RABBITHOLE_ISOLATION_KEY"',
  'wire_api = "responses"',
  "requires_openai_auth = false",
  "supports_standalone_web_search = true",
].join("\n");

const baseEnv = {
  ...process.env,
  HOME: home,
  CODEX_HOME: path.join(home, ".codex"),
  RABBITHOLE_DIR: data,
  RABBITHOLE_ISOLATION_KEY: "offline-test-key",
};
const executable = resolveExecutable("codex", undefined, baseEnv);
assert.ok(executable, "acceptance A/C require an installed codex binary");
const configPath = path.join(baseEnv.CODEX_HOME, "config.toml");
const isolationFixture = '\n[mcp_servers.user_server]\ncommand = "should-never-start"\nenabled = true\n';
await fs.writeFile(configPath, 'web_search = "disabled"\n' + providerConfig + isolationFixture);
const env = baseEnv;
let appServer = new CodexAppServer({
  executable,
  env,
  cwd,
  version: "0.4.0-test",
});

try {
  await appServer.ensureStarted().catch((error) => {
    throw new Error(
      `app-server start failed: ${JSON.stringify({
        protocol: appServer.lastProtocolError,
        modes: appServer.modeList,
      })}`,
      { cause: error }
    );
  });
  const thread = await appServer.request("thread/start", {
    model: "rabbithole-isolation-model",
    cwd,
    approvalPolicy: "never",
    sandbox: "read-only",
    ephemeral: true,
    developerInstructions: "",
    environments: [],
    dynamicTools: [],
    selectedCapabilityRoots: [],
  }).catch((error) => {
    throw new Error(
      `thread/start failed: ${JSON.stringify(appServer.lastProtocolError)}`,
      { cause: error }
    );
  });
  assert.ok(thread?.thread?.id);
  await appServer.request("turn/start", {
    threadId: thread.thread.id,
    input: [{ type: "text", text: "Reply with OK." }],
    cwd,
    environments: [],
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly", networkAccess: false },
    model: "rabbithole-isolation-model",
    effort: "medium",
    summary: "none",
    collaborationMode: appServer.executionMode({
      model: "rabbithole-isolation-model",
      effort: "medium",
      developerInstructions: "",
    }),
  });
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Codex did not contact the loopback provider")), 10_000);
  });
  const providerRequest = await Promise.race([captured, timeout]);
  const capturedToolNames = providerRequest.tools.map((tool) => tool.name);
  assert.deepEqual(capturedToolNames, [], "search-off generation exposes no tools");
  assert.equal(/mcp__|tool_search/i.test(JSON.stringify(providerRequest)), false);
  process.stdout.write(`acceptance A tools=${JSON.stringify(capturedToolNames)}\n`);

  await appServer.close();
  await fs.writeFile(configPath, 'web_search = "live"\n' + providerConfig + isolationFixture + '\n[features]\nstandalone_web_search = true\n');
  appServer = new CodexAppServer({ executable, env, cwd, version: "0.4.0-test" });
  await appServer.ensureStarted();
  const searchEvents = [];
  let streamed = "";
  const answer = await appServer.turn({
    model: "rabbithole-isolation-model", input: [{ type: "text", text: "Search offline" }], instructions: "Reply directly.",
    reasoningEffort: "medium", signal: new AbortController().signal,
    onDelta: (text) => { streamed += text; }, onSearch: (event) => searchEvents.push(event),
  });
  assert.deepEqual(searchEvents.map((event) => event.status), ["searching", "completed"]);
  assert.equal(searchRequests.length, 1);
  assert.equal(searchRequests[0].authorization, "Bearer offline-test-key");
  assert.deepEqual(searchRequests[0].body.commands, { search_query: [{ q: "offline search" }] });
  assert.equal(searchRequests[0].body.settings.external_web_access, true);
  assert.equal(answer.text, "Found [Example](<https://example.com/result>).");
  assert.equal(streamed, answer.text);
  assert.deepEqual(providerRequests.at(-1).tools.map((tool) => tool.name), ["web"]);
  assert.equal(providerRequests.at(-1).tools.find((tool) => tool.name === "web").type, "namespace");
  assert.equal(providerRequests.at(-1).tools.some((tool) => tool.type === "web_search"), false);
  process.stdout.write("native search: alpha/search roundtrip, source citations, isolated tools=web\n");


  const beforeArticle = providerRequests.length;
  const article = await appServer.turn({
    model: "rabbithole-isolation-model", input: [{ type: "text", text: "IMPORTED-ARTICLE: persistent article." }], instructions: "Reply directly.",
    reasoningEffort: "medium", signal: new AbortController().signal, onDelta() {},
    sourceSession: null,
  });
  assert.equal(providerRequests.length, beforeArticle + 1, "article generation invokes the model in a persistent session");
  assert.ok(article.session?.sessionId);
  const rootIdentity = providerHeaders.at(-1)["session-id"];
  const rootCacheKey = providerRequests.at(-1).prompt_cache_key;
  assert.equal(rootIdentity, article.session.sessionId);
  assert.equal(rootCacheKey, rootIdentity);
  await appServer.close();
  await fs.writeFile(configPath, 'web_search = "disabled"\n' + providerConfig + isolationFixture);
  appServer = new CodexAppServer({ executable, env, cwd, version: "0.4.0-test" });
  await appServer.ensureStarted();
  const child = await appServer.turn({
    model: "rabbithole-isolation-model", input: [{ type: "text", text: "FORK-CHECK: first child." }], instructions: "Reply directly.",
    reasoningEffort: "medium", signal: new AbortController().signal, onDelta() {},
    sourceSession: article.session,
  });
  assert.equal(child.text, "Fork verified.");
  assert.equal(providerHeaders.at(-1)["session-id"], rootIdentity, "fork reuses root cache session after restart");
  assert.equal(providerRequests.at(-1).prompt_cache_key, rootCacheKey);
  assert.equal(providerHeaders.at(-1)["thread-id"], child.session.sessionId);
  assert.notEqual(child.session.sessionId, article.session.sessionId);
  assert.match(JSON.stringify(providerRequests.at(-1).input), /IMPORTED-ARTICLE/);
  assert.deepEqual(providerRequests.at(-1).tools, [], "fork uses current search-off configuration");
  await appServer.close();
  await fs.writeFile(configPath, 'web_search = "live"\n' + providerConfig + isolationFixture + '\n[features]\nstandalone_web_search = true\n');
  appServer = new CodexAppServer({ executable, env, cwd, version: "0.4.0-test" });
  await appServer.ensureStarted();
  const descendant = await appServer.turn({
    model: "rabbithole-isolation-model", input: [{ type: "text", text: "FORK-CHECK: descendant." }], instructions: "Reply directly.",
    reasoningEffort: "medium", signal: new AbortController().signal, onDelta() {},
    sourceSession: child.session,
  });
  assert.equal(descendant.session.scopeId, article.session.scopeId);
  assert.notEqual(descendant.session.sessionId, child.session.sessionId);
  assert.equal(providerHeaders.at(-1)["session-id"], rootIdentity, "descendant resolves original root after second restart");
  assert.equal(providerHeaders.at(-1)["thread-id"], descendant.session.sessionId);
  assert.equal(providerRequests.at(-1).prompt_cache_key, rootCacheKey);
  assert.match(JSON.stringify(providerRequests.at(-1).input), /first child/);
  assert.match(JSON.stringify(providerRequests.at(-1).input), /Fork verified/);
  assert.deepEqual(providerRequests.at(-1).tools.map((tool) => tool.name), ["web"], "descendant uses current search-on configuration");
  const sibling = await appServer.turn({
    model: "rabbithole-isolation-model", input: [{ type: "text", text: "FORK-CHECK: sibling." }], instructions: "Reply directly.",
    reasoningEffort: "medium", signal: new AbortController().signal, onDelta() {}, sourceSession: article.session,
  });
  assert.notEqual(sibling.session.sessionId, child.session.sessionId);
  assert.equal(providerHeaders.at(-1)["session-id"], rootIdentity);
  assert.equal(providerHeaders.at(-1)["thread-id"], sibling.session.sessionId);
  assert.equal(providerRequests.at(-1).prompt_cache_key, rootCacheKey);
  assert.doesNotMatch(JSON.stringify(providerRequests.at(-1).input), /first child/);
  process.stdout.write("persistent article: model completion; restart fork: inherited article and child answer\n");

  await appServer.close();
  await fs.mkdir(path.dirname(egoSkill), { recursive: true });
  await fs.writeFile(egoSkill, "---\nname: ego-browser\ndescription: Browse with Ego.\n---\n\nEGO_SKILL_INSTRUCTIONS\n");
  const otherSkill = path.join(home, ".agents/skills/unrelated-skill/SKILL.md");
  await fs.mkdir(path.dirname(otherSkill), { recursive: true });
  await fs.writeFile(otherSkill, "---\nname: unrelated-skill\ndescription: UNRELATED_SKILL_DESCRIPTION\n---\nUNRELATED_SKILL_BODY\n");
  await fs.writeFile(configPath, 'web_search = "disabled"\n' + providerConfig + isolationFixture);
  appServer = new CodexAppServer({ executable, env: { ...env, RABBITHOLE_BRIDGE_EGO_BIN: egoExecutable }, cwd, version: "0.4.0-test" });
  await appServer.ensureStarted();
  const beforeEgo = providerRequests.length;
  const egoAnswer = await appServer.turn({
    model: "rabbithole-isolation-model", input: [{ type: "text", text: "EGO-CHECK: browse using the selected skill." }], instructions: "Reply directly.",
    reasoningEffort: "medium", signal: new AbortController().signal, onDelta() {},
    sourceSession: article.session,
  });
  assert.equal(egoAnswer.text, "Browser verified.");
  const egoRequests = providerRequests.slice(beforeEgo);
  assert.equal(egoRequests.length, 2, "installed Codex completes the MCP browser round trip");
  assert.match(JSON.stringify(egoRequests[0].input), /EGO_SKILL_INSTRUCTIONS/);
  assert.equal(/UNRELATED_SKILL_(?:DESCRIPTION|BODY)/.test(JSON.stringify(egoRequests)), false);
  const egoTools = egoRequests.flatMap((request) => [...(request.tools || []), ...(request.input.find((item) => item.type === "additional_tools")?.tools || [])]);
  const egoToolNames = egoTools.map((tool) => tool.name);
  const egoNamespace = egoTools.find((tool) => tool.name === "mcp__rabbithole_ego_browser");
  assert.deepEqual(egoNamespace?.tools?.map((tool) => tool.name), ["ego_browser"], JSON.stringify(egoToolNames));
  assert.equal(egoToolNames.some((name) => /exec_command|shell|user_server/.test(name)), false);
  assert.match(JSON.stringify(egoRequests[1].input), /EGO_TOOL_ROUNDTRIP/);
  assert.equal(await fs.readFile(configPath, "utf8"), 'web_search = "disabled"\n' + providerConfig + isolationFixture);
  process.stdout.write(`ego-browser: one skill, no shell/user MCP, article fork tool round trip; tools=${JSON.stringify(egoToolNames)}\n`);

  const started = process.hrtime.bigint();
  const mcp = await execFileAsync(executable, ["mcp", ...codexIsolationArgs(), "-c", 'mcp_servers={"user_server"={enabled=false}}', "list", "--json"], {
    cwd,
    env,
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const mcpList = JSON.parse(mcp.stdout);
  assert.equal(mcpList.length, 1);
  assert.equal(mcpList[0].enabled, false);
  assert.ok(elapsedMs < 1000, `private Codex MCP list took ${elapsedMs.toFixed(1)}ms`);
  const cachePath = path.join(data, "codex-models.json");
  const cacheExists = await fs.access(cachePath).then(() => true, () => false);
  assert.equal(cacheExists, false);
  await appServer.close();
  const builtinConfig = 'model = "rabbithole-isolation-model"\nmodel_provider = "openai"\nweb_search = "disabled"\n'
    + `openai_base_url = "http://127.0.0.1:${stubPort}/builtin/v1"\n`;
  await fs.writeFile(configPath, builtinConfig);
  await fs.writeFile(path.join(baseEnv.CODEX_HOME, "auth.json"), JSON.stringify({ OPENAI_API_KEY: "offline-test-key" }));
  appServer = new CodexAppServer({ executable, env, cwd, version: "0.4.0-test" });
  await appServer.ensureStarted();
  const builtinRoot = await appServer.turn({
    model: "rabbithole-isolation-model", input: [{ type: "text", text: "FORK-CHECK: builtin root." }], instructions: "Reply directly.",
    reasoningEffort: "medium", signal: new AbortController().signal, onDelta() {},
  });
  const builtinChild = await appServer.turn({
    model: "rabbithole-isolation-model", input: [{ type: "text", text: "FORK-CHECK: builtin child." }], instructions: "Reply directly.",
    reasoningEffort: "medium", signal: new AbortController().signal, onDelta() {}, sourceSession: builtinRoot.session,
  });
  assert.equal(providerHeaders.at(-1)["session-id"], builtinRoot.session.sessionId);
  assert.equal(providerHeaders.at(-1)["thread-id"], builtinChild.session.sessionId);
  assert.equal(providerRequests.at(-1).prompt_cache_key, builtinRoot.session.sessionId);
  assert.equal(providerHeaders.at(-1).authorization, "Bearer offline-test-key");
  assert.equal(await fs.readFile(configPath, "utf8"), builtinConfig);
  process.stdout.write("builtin OpenAI: private runtime endpoint, independent fork and shared cache identity\n");
  process.stdout.write(
      `acceptance C mcp=${JSON.stringify(mcpList)} elapsed_ms=${elapsedMs.toFixed(1)} `
    + `cache_exists=${cacheExists} source_guard=clean\n`
  );
} finally {
  await appServer.close();
  await new Promise((resolve) => stub.close(resolve));
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

process.stdout.write("codex isolation ok\n");
