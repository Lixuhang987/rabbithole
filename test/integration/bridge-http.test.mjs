/** @protects bridge http capability contracts. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProvider } from "../../src/web/provider/openai-compatible.js";
import { DirectRabbitholeHost, createPendingHoleFromQuestion, createHoleFromMarkdown } from "../../src/web/transport/direct-host.js";
import { createPortableProjection } from "../../src/core/portable-projection.js";
import { toPersistedHole } from "../../src/core/schema.js";
import { createSnapshotProjection } from "../../src/core/snapshot-projection.js";
import { applyServerEvent } from "../../src/ui/store/apply-server-event.js";
import { createBridge } from "../../src/node/bridge/server.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FAKE_CLAUDE = path.join(ROOT, "test/integration/fixtures/fake-claude.mjs");
const FAKE_CODEX = path.join(ROOT, "test/integration/fixtures/fake-codex.mjs");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-bridge-http-"));
const home = path.join(temporaryRoot, "home");
const data = path.join(temporaryRoot, "data");
const claudeRecord = path.join(temporaryRoot, "claude.ndjson");
const codexRecord = path.join(temporaryRoot, "codex.ndjson");
const codexThreadRecord = path.join(temporaryRoot, "codex-threads.ndjson");
const codexHistory = path.join(temporaryRoot, "codex-history.json");
const codexProtocolRecord = path.join(temporaryRoot, "codex-protocol.ndjson");
const codexArgsRecord = path.join(temporaryRoot, "codex-args.ndjson");
const egoSkill = path.join(home, ".agents/skills/ego-browser/SKILL.md");
const egoExecutable = path.join(ROOT, "test/integration/fixtures/fake-ego-browser.mjs");
await fs.mkdir(path.dirname(egoSkill), { recursive: true });
await fs.writeFile(egoSkill, "---\nname: ego-browser\ndescription: Browse with Ego.\n---\n\nEGO_BROWSER_SKILL_BODY\n");
await fs.mkdir(path.join(home, ".codex"), { recursive: true });
await fs.writeFile(path.join(home, ".codex", "auth.json"), "{}\n");
const userConfig = 'web_search = "cached"\n[features]\nstandalone_web_search = false\n';
await fs.writeFile(path.join(home, ".codex", "config.toml"), userConfig);

/** @param {any} bridge @param {{method?: string, pathname?: string, headers?: Record<string, any>, body?: any}} [options] */
function request(bridge, {
  method = "GET",
  pathname = "/v1/models",
  headers = {},
  body,
} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: bridge.port,
      method,
      path: pathname,
      headers,
    }, (res) => {
      res.setEncoding("utf8");
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        let json;
        if (raw) {
          try {
            json = JSON.parse(raw);
          } catch {
            json = undefined;
          }
        }
        resolve({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.once("error", reject);
    req.end(body);
  });
}

function authHeaders(bridge, extra = {}) {
  return {
    Authorization: `Bearer ${bridge.token}`,
    ...extra,
  };
}

async function chat(bridge, payload, headers = {}) {
  const body = JSON.stringify(payload);
  return request(bridge, {
    method: "POST",
    pathname: "/v1/chat/completions",
    headers: authHeaders(bridge, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      ...headers,
    }),
    body,
  });
}

async function firstSseState(bridge) {
  const controller = new AbortController();
  const response = await fetch(`${bridge.url}/bridge/events`, {
    headers: authHeaders(bridge),
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
  const data = raw.split(/\r?\n/).find((line) => line.startsWith("data: "));
  return JSON.parse(data.slice(6));
}

let bridge;
try {
  const createTestBridge = () => createBridge({
    port: 0,
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: undefined,
      RABBITHOLE_DIR: data,
      RABBITHOLE_BRIDGE_CLAUDE_BIN: FAKE_CLAUDE,
      RABBITHOLE_BRIDGE_CODEX_BIN: FAKE_CODEX,
      RABBITHOLE_BRIDGE_EGO_BIN: egoExecutable,
      FAKE_CLAUDE_RECORD: claudeRecord,
      FAKE_CODEX_RECORD: codexRecord,
      FAKE_CODEX_HISTORY: codexHistory,
      FAKE_CODEX_PROTOCOL_RECORD: codexProtocolRecord,
      FAKE_CODEX_THREAD_RECORD: codexThreadRecord,
      FAKE_CODEX_APP_SERVER_ARGS: codexArgsRecord,
      CLAUDE_CONFIG_DIR: path.join(temporaryRoot, "must-not-be-used"),
    },
    version: "0.4.0-test",
    stateRefreshMs: 60_000,
  });
  bridge = await createTestBridge();
  await bridge.start();
  await bridge.refreshState();

  const seventeenMiB = Buffer.alloc(17 * 1024 * 1024, 0x20);
  const rows = [
    {
      name: "no token",
      run: () => request(bridge),
      status: 401,
      code: "unauthorized",
    },
    {
      name: "wrong token",
      run: () => request(bridge, { headers: { Authorization: "Bearer wrong" } }),
      status: 401,
      code: "unauthorized",
    },
    {
      name: "foreign origin",
      run: () => request(bridge, {
        headers: authHeaders(bridge, { Origin: "https://attacker.example" }),
      }),
      status: 403,
      code: "forbidden_origin",
    },
    {
      name: "foreign host",
      run: () => request(bridge, {
        headers: authHeaders(bridge, { Host: "attacker.example" }),
      }),
      status: 403,
      code: "forbidden_host",
    },
    {
      name: "text content type",
      run: () => request(bridge, {
        method: "POST",
        pathname: "/v1/chat/completions",
        headers: authHeaders(bridge, { "Content-Type": "text/plain" }),
        body: "{}",
      }),
      status: 415,
      code: "unsupported_media_type",
    },
    {
      name: "17 MiB body",
      run: () => request(bridge, {
        method: "POST",
        pathname: "/v1/chat/completions",
        headers: authHeaders(bridge, {
          "Content-Type": "application/json",
          "Content-Length": seventeenMiB.length,
        }),
        body: seventeenMiB,
      }),
      status: 413,
      code: "payload_too_large",
    },
    {
      name: "native no origin",
      run: () => request(bridge, { headers: authHeaders(bridge) }),
      status: 200,
    },
    {
      name: "allowed preflight",
      run: () => request(bridge, {
        method: "OPTIONS",
        pathname: "/v1/chat/completions",
        headers: {
          Origin: "https://rabbithole.ing",
          "Access-Control-Request-Headers": "authorization, content-type",
          "Access-Control-Request-Private-Network": "true",
        },
      }),
      status: 204,
      lna: "true",
    },
    {
      name: "foreign preflight",
      run: () => request(bridge, {
        method: "OPTIONS",
        pathname: "/v1/chat/completions",
        headers: { Origin: "https://attacker.example" },
      }),
      status: 403,
      code: "forbidden_origin",
      noAcao: true,
    },
    // /bridge/ping is the one unauthenticated route: the pre-pairing panel
    // needs a CORS-readable liveness answer. Host/Origin gates still apply,
    // and it must reveal nothing beyond {"ok":true}.
    {
      name: "ping no token allowed origin",
      run: () => request(bridge, {
        pathname: "/bridge/ping",
        headers: { Origin: "https://rabbithole.ing" },
      }),
      status: 200,
      acao: "https://rabbithole.ing",
    },
    {
      name: "ping foreign origin",
      run: () => request(bridge, {
        pathname: "/bridge/ping",
        headers: { Origin: "https://attacker.example" },
      }),
      status: 403,
      code: "forbidden_origin",
      noAcao: true,
    },
    {
      name: "ping foreign host",
      run: () => request(bridge, {
        pathname: "/bridge/ping",
        headers: { Host: "attacker.example" },
      }),
      status: 403,
      code: "forbidden_host",
      noAcao: true,
    },
  ];

  const observed = [];
  for (const row of rows) {
    const result = await row.run();
    assert.equal(result.status, row.status, row.name);
    if (row.code) assert.equal(result.json?.error?.code, row.code, row.name);
    if (row.lna) {
      assert.equal(result.headers["access-control-allow-private-network"], row.lna);
    }
    if (row.noAcao || row.code === "unauthorized") {
      assert.equal(result.headers["access-control-allow-origin"], undefined);
    }
    if (row.acao) assert.equal(result.headers["access-control-allow-origin"], row.acao, row.name);
    observed.push({
      name: row.name,
      status: result.status,
      code: result.json?.error?.code || null,
      lna: result.headers["access-control-allow-private-network"] || null,
      acao: result.headers["access-control-allow-origin"] || null,
    });
  }
  assert.equal(observed.length, rows.length, "acceptance E capture must include every gate row");
  process.stdout.write(`acceptance E ${JSON.stringify(observed)}\n`);

  const allowedUnauthorized = await request(bridge, {
    headers: { Origin: "https://rabbithole.ing" },
  });
  assert.equal(allowedUnauthorized.status, 401);
  assert.equal(allowedUnauthorized.headers["access-control-allow-origin"], undefined);

  const ping = await request(bridge, { pathname: "/bridge/ping" });
  assert.equal(ping.status, 200);
  assert.deepEqual(ping.json, { ok: true }, "ping reveals nothing beyond liveness");

  const deletedStatus = await request(bridge, {
    pathname: "/bridge/status",
    headers: authHeaders(bridge),
  });
  assert.equal(deletedStatus.status, 404);

  const state = await firstSseState(bridge);
  assert.equal(state.bridge, "0.4.0-test");
  assert.equal(state.agents.length, 2);
  for (const agent of state.agents) {
    assert.equal(agent.state, "ready");
    assert.ok(agent.models.length > 0);
    assert.equal(Object.hasOwn(agent, "fix"), false);
  }

  const models = await request(bridge, { headers: authHeaders(bridge) });
  assert.equal(models.status, 200);
  assert.equal(models.json.object, "list");
  assert.equal(models.json.data.find((model) => model.id === "codex/gpt-fake").images, true);
  assert.equal(models.json.data.find((model) => model.id === "codex/gpt-second").images, false);

  const claude = await chat(bridge, {
    model: "claude/sonnet",
    messages: [{ role: "user", content: "Say OK" }],
    stream: false,
    reasoning_effort: "high",
  });
  assert.equal(claude.status, 200);
  assert.equal(claude.json.choices[0].message.content, "OK");
  const claudeCall = JSON.parse((await fs.readFile(claudeRecord, "utf8")).trim().split("\n").at(-1));
  assert.equal(claudeCall.claudeConfigDir, undefined);
  assert.equal(claudeCall.args.includes("--bare"), false);
  assert.deepEqual(
    claudeCall.args.slice(claudeCall.args.indexOf("--model"), claudeCall.args.indexOf("--model") + 4),
    ["--model", "sonnet", "--effort", "high"]
  );

  const codex = await chat(bridge, {
    model: "codex/gpt-fake",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Read the image" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AQID", detail: "high" } },
      ],
    }],
    stream: false,
    reasoning_effort: "xhigh",
  });
  assert.equal(codex.status, 200);
  assert.equal(codex.json.choices[0].message.content, "OK");
  const codexCall = JSON.parse((await fs.readFile(codexRecord, "utf8")).trim().split("\n").at(-1));
  assert.equal(codexCall.model, "gpt-fake");
  assert.equal(codexCall.effort, "xhigh");
  assert.match(codexCall.collaborationMode.settings.developer_instructions, /EGO_BROWSER_SKILL_BODY/);
  assert.deepEqual(codexCall.input[1], {
    type: "image",
    url: "data:image/png;base64,AQID",
    detail: "high",
  });

  const saved = [];
  const searchEvents = [];
  const provider = createProvider({ preset: "subscriptions", base_url: `${bridge.url}/v1`, model: "codex/gpt-fake", web_search: "auto" }, bridge.token);
  const hole = createPendingHoleFromQuestion("SEARCH current information");
  const host = new DirectRabbitholeHost({ hole, provider, store: { saveHole: async (value) => saved.push(structuredClone(value)) } });
  const uiNode = { id: hole.root_id, status: "pending", markdown: "", extensions: {} };
  host.onEvent = (event) => {
    if (event.type === "node_search_status") {
      searchEvents.push(event);
      if (event.node_id === uiNode.id) {
        applyServerEvent({ nodes: { [uiNode.id]: uiNode } }, event);
        assert.equal(uiNode._searchStatus, event.status === "searching" ? "searching" : null);
      }
    }
  };
  await host.runRootAnswer(hole.root_id, "SEARCH current information", new AbortController());
  assert.deepEqual(searchEvents.map((event) => event.status), ["searching", "completed"], "native search lifecycle reaches the browser host");
  assert.equal(saved.length, 1);
  const rootConversation = host.state.nodes.get(hole.root_id).extensions.codex_conversation;
  assert.equal(rootConversation?.version, 1, "completed root articles retain their Codex conversation");
  assert.equal(typeof rootConversation.threadId, "string");
  assert.equal(typeof rootConversation.scopeId, "string");
  const markdown = saved[0].nodes[0].markdown;
  assert.ok(markdown.startsWith("> **Original question**\n>\n> SEARCH current information\n\n# Search answer"), "the original question precedes the answer, without Codex commentary");
  assert.match(markdown, /https:\/\/example\.com\/search-result/);
  assert.equal(markdown.includes(""), false, "fragmented native citations become durable Markdown");
  assert.equal(markdown.includes("javascript:"), false);
  assert.match(markdown, /source unavailable/i);
  assert.equal(JSON.stringify(saved[0]).includes("turn0search"), false, "ephemeral backend refs are not persisted");
  assert.equal(JSON.stringify(saved[0]).includes("_searchStatus"), false);
  const persisted = toPersistedHole(saved[0]);
  const portable = createPortableProjection(persisted, {});
  assert.equal(portable.hole.nodes[0].markdown, markdown);
  assert.equal(portable.hole.nodes[0].extensions.codex_conversation, undefined, "portable files exclude local conversations");
  assert.deepEqual(persisted.nodes[0].extensions.codex_conversation, rootConversation, "export does not mutate local associations");
  assert.equal(createSnapshotProjection(persisted, persisted.view_state, {}).hole.nodes[0].markdown, markdown);
  const threadCalls = () => fs.readFile(codexThreadRecord, "utf8").then((raw) => raw.trim().split("\n").map((line) => JSON.parse(line)));
  assert.equal((await threadCalls()).at(-1).config, undefined);
  const branchResult = await host.handleBrowserEvent({ type: "branch_request", node_id: "search-branch", parent_id: hole.root_id, question: "SEARCH branch", selected_text: "Found online", position: { x: 100, y: 100 } });
  assert.equal(branchResult.ok, true);
  const branchDeadline = Date.now() + 5000;
  while (host.state.nodes.get("search-branch")?.status !== "answered" && Date.now() < branchDeadline) await new Promise((resolve) => setTimeout(resolve, 10));
  const branchNode = host.state.nodes.get("search-branch");
  assert.equal(branchNode.status, "answered");
  assert.equal(branchNode.title, "Search branch");
  assert.match(branchNode.markdown, /https:\/\/example\.com\/search-result/);
  assert.equal(branchNode.markdown.includes("TITLE:"), false);
  assert.equal(branchNode.markdown.includes("I will search"), false);
  assert.deepEqual(searchEvents.map((event) => event.status), ["searching", "completed", "searching", "completed"]);
  const turnCalls = async () => (await fs.readFile(codexRecord, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const protocolCalls = async () => (await fs.readFile(codexProtocolRecord, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  const waitForAnswered = async (activeHost, id) => {
    const deadline = Date.now() + 5000;
    while (activeHost.state.nodes.get(id)?.status !== "answered" && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(activeHost.state.nodes.get(id)?.status, "answered", `article ${id} completes`);
    return activeHost.state.nodes.get(id);
  };
  const ask = async (activeHost, id, parent, question = "Explain this", selected = "") => {
    assert.equal((await activeHost.handleBrowserEvent({ type: "branch_request", node_id: id, parent_id: parent, question, selected_text: selected, position: { x: 0, y: 0 } })).ok, true);
    return waitForAnswered(activeHost, id);
  };
  const branchConversation = branchNode.extensions.codex_conversation;
  assert.notEqual(branchConversation.threadId, rootConversation.threadId);
  assert.equal((await protocolCalls()).slice().reverse().find((call) => call.method === "thread/fork").params.threadId, rootConversation.threadId);
  const incremental = (await turnCalls()).at(-1);
  assert.equal(incremental.input[0].text.includes("Parent document markdown:"), false);
  assert.equal(incremental.input[0].text.includes("Original canvas question:"), false);
  assert.match(JSON.stringify(incremental.inheritedHistory), /SEARCH current information/);
  const sibling = await ask(host, "sibling", hole.root_id, "Independent sibling");
  const siblingHistory = JSON.stringify((await turnCalls()).at(-1).inheritedHistory);
  assert.match(siblingHistory, /SEARCH current information/);
  assert.equal(siblingHistory.includes("SEARCH branch"), false, "siblings do not inherit one another's Ask");
  assert.notEqual(sibling.extensions.codex_conversation.threadId, branchConversation.threadId);
  await ask(host, "descendant", branchNode.id, "Explain the child's answer");
  assert.match(JSON.stringify((await turnCalls()).at(-1).inheritedHistory), /SEARCH branch/);
  assert.equal((await protocolCalls()).slice().reverse().find((call) => call.method === "thread/fork").params.threadId, branchConversation.threadId);
  const reopen = new DirectRabbitholeHost({ hole: saved.at(-1), provider, store: { saveHole: async () => {} } });
  await ask(reopen, "reopened", branchNode.id, "Ask after reopening");
  assert.equal((await protocolCalls()).slice().reverse().find((call) => call.method === "thread/fork").params.threadId, branchConversation.threadId);
  await reopen.dispose();

  const previousFileReader = globalThis.FileReader;
  (/** @type {any} */ (globalThis)).FileReader = class {
    /** @type {any} */ result = null;
    /** @type {any} */ error = null;
    /** @type {any} */ onload = null;
    /** @type {any} */ onerror = null;
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload?.();
      }, (error) => { this.error = error; this.onerror?.(); });
    }
  };
  const pastedBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const pastedAssets = new Map();
  const imageHole = createHoleFromMarkdown({ markdown: "# Image question\n\nRead my screenshot." });
  const imageHost = new DirectRabbitholeHost({ hole: imageHole, provider, store: {
    saveHole: async () => {},
    putAsset: async (_hole, name, bytes) => pastedAssets.set(name, new Blob([bytes], { type: "image/png" })),
    getAsset: async (_hole, name) => pastedAssets.get(name),
  } });
  assert.equal((await imageHost.adapter().putAsset("paste-codex.png", new Blob([pastedBytes], { type: "image/png" }))).ok, true);
  assert.equal((await imageHost.handleBrowserEvent({ type: "branch_request", node_id: "image-ask", parent_id: imageHole.root_id,
    question: "", selected_text: "", branch_type: "followup", attachment_assets: ["paste-codex.png"], position: { x: 0, y: 0 } })).ok, true);
  const imageAnswer = await waitForAnswered(imageHost, "image-ask");
  assert.deepEqual(imageAnswer.origin.attachment_assets, ["paste-codex.png"]);
  assert.deepEqual((await turnCalls()).at(-1).input[1], {
    type: "image", url: `data:image/png;base64,${pastedBytes.toString("base64")}`, detail: "auto",
  }, "durable image-only Ask assets must reach Codex app-server as actual image input");
  await imageHost.dispose();
  (/** @type {any} */ (globalThis)).FileReader = previousFileReader;

  const importedHole = createHoleFromMarkdown({ markdown: "# Imported article\n\nUnique imported parent context." });
  const importedSaved = [];
  const importedHost = new DirectRabbitholeHost({ hole: importedHole, provider, store: { saveHole: async (value) => importedSaved.push(structuredClone(value)) } });
  const turnsBeforeImport = (await turnCalls()).length;
  const injectionsBefore = (await protocolCalls()).filter((call) => call.method === "thread/inject_items").length;
  await Promise.all([ask(importedHost, "import-first", importedHole.root_id, "First imported Ask"), ask(importedHost, "import-second", importedHole.root_id, "Second imported Ask")]);
  assert.equal((await turnCalls()).length - turnsBeforeImport, 2, "baseline injection makes no extra model call");
  assert.equal((await protocolCalls()).filter((call) => call.method === "thread/inject_items").length - injectionsBefore, 1, "concurrent first Asks share one baseline");
  const baseline = importedHost.state.nodes.get(importedHole.root_id).extensions.codex_conversation;
  const importedForks = (await protocolCalls()).filter((call) => call.method === "thread/fork" && call.params.threadId === baseline.threadId);
  assert.equal(importedForks.length, 2);
  const importedHistory = JSON.stringify((await turnCalls()).at(-1).inheritedHistory);
  assert.match(importedHistory, /Unique imported parent context/);
  assert.equal(importedHistory.includes("First imported Ask"), false);
  assert.equal(importedHistory.includes("Second imported Ask"), false);
  const stale = { ...baseline, threadId: "missing-history" };
  importedHost.engine.patchExtension(importedHole.root_id, "codex_conversation", stale);
  importedHost.state = importedHost.engine.state;
  const beforeRecovery = (await turnCalls()).length;
  await ask(importedHost, "recovered", importedHole.root_id, "Ask with missing history");
  assert.equal((await turnCalls()).length - beforeRecovery, 1, "missing history rebuilds before any failed model turn");
  const recoveredBaseline = importedHost.state.nodes.get(importedHole.root_id).extensions.codex_conversation;
  assert.notEqual(recoveredBaseline.threadId, stale.threadId);
  assert.match(JSON.stringify((await turnCalls()).at(-1).inheritedHistory), /Unique imported parent context/);
  importedHost.engine.patchExtension(importedHole.root_id, "codex_conversation", { ...recoveredBaseline, scopeId: "other-history-store" });
  importedHost.state = importedHost.engine.state;
  await ask(importedHost, "rescope", importedHole.root_id, "Ask on another history store");
  assert.equal(importedHost.state.nodes.get(importedHole.root_id).extensions.codex_conversation.scopeId, rootConversation.scopeId);
  const failures = [];
  importedHost.onEvent = (event) => { if (event.type === "node_error") failures.push(event); };
  await importedHost.handleBrowserEvent({ type: "branch_request", node_id: "failed-attempt", parent_id: importedHole.root_id, question: "SEARCH FAIL ONCE", position: { x: 0, y: 0 } });
  const failedDeadline = Date.now() + 5000;
  while (!failures.length && Date.now() < failedDeadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(failures.at(-1)?.code, "web_search_failed");
  assert.equal(importedHost.state.nodes.get("failed-attempt").extensions.codex_conversation, undefined);
  const failedThread = (await turnCalls()).at(-1).threadId;
  assert.equal(importedHost.handleRetry({ node_id: "failed-attempt" }).ok, true);
  const retried = await waitForAnswered(importedHost, "failed-attempt");
  assert.notEqual(retried.extensions.codex_conversation.threadId, failedThread);
  assert.equal(JSON.stringify((await turnCalls()).at(-1).inheritedHistory).includes("SEARCH FAIL ONCE"), false, "retry inherits source, not failed output");

  const beforeCancel = (await turnCalls()).length;
  await importedHost.handleBrowserEvent({ type: "branch_request", node_id: "cancelled", parent_id: importedHole.root_id, question: "SLOW cancelled Ask", position: { x: 0, y: 0 } });
  const cancelDeadline = Date.now() + 5000;
  while ((await turnCalls()).length === beforeCancel && Date.now() < cancelDeadline) await new Promise((resolve) => setTimeout(resolve, 10));
  const cancelledThread = (await turnCalls()).at(-1).threadId;
  assert.equal((await importedHost.handleBrowserEvent({ type: "delete_node", node_id: "cancelled" })).ok, true);
  await ask(importedHost, "after-cancel", importedHole.root_id, "Ask after cancellation");
  assert.equal(importedHost.state.nodes.has("cancelled"), false);
  assert.equal(JSON.stringify((await turnCalls()).at(-1).inheritedHistory).includes("SLOW cancelled Ask"), false);
  assert.ok((await protocolCalls()).some((call) => call.method === "turn/interrupt" && call.params.threadId === cancelledThread));
  await importedHost.dispose();

  const off = createProvider({ preset: "subscriptions", base_url: `${bridge.url}/v1`, model: "codex/gpt-fake", web_search: "off" }, bridge.token);
  for await (const _event of off.authorExplainer({ question: "No search" })) {}
  assert.equal((await threadCalls()).at(-1).config, undefined);
  for await (const _event of provider.authorDocument({ markdown: "Original source" })) {}
  assert.equal((await threadCalls()).at(-1).config, undefined, "source authoring inherits Codex search configuration too");
  await host.dispose();

  const noImages = await chat(bridge, {
    model: "codex/gpt-second",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Read this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
      ],
    }],
    stream: false,
  });
  assert.equal(noImages.status, 400);
  assert.equal(noImages.json.error.code, "model_no_images");

  const codexLaunch = (await fs.readFile(codexArgsRecord, "utf8")).trim().split("\n").map((line) => JSON.parse(line)).find((call) => call.args[0] === "app-server");
  assert.equal(codexLaunch.codexHome, undefined);
  assert.ok(codexLaunch.args.includes('skills.include_instructions=false'));
  assert.ok(codexLaunch.args.includes('sandbox_mode="danger-full-access"'));
  assert.ok(codexLaunch.args.includes('approval_policy="never"'));
  const executionCalls = (await protocolCalls()).filter((call) => ["thread/start", "thread/fork"].includes(call.method));
  assert.ok(executionCalls.some((call) => call.method === "thread/start"));
  assert.ok(executionCalls.some((call) => call.method === "thread/fork"));
  for (const call of executionCalls) {
    assert.equal(call.params.approvalPolicy, "never");
    assert.equal(call.params.sandbox, "danger-full-access");
  }
  const executionTurns = await turnCalls();
  assert.ok(executionTurns.length > 0);
  for (const call of executionTurns) {
    assert.equal(call.approvalPolicy, "never");
    assert.deepEqual(call.sandboxPolicy, { type: "dangerFullAccess" });
  }
  const mcpOverlay = codexLaunch.args.find((arg) => arg.startsWith("mcp_servers={"));
  assert.match(mcpOverlay, /"user_server"=\{enabled=false\}/);
  assert.match(mcpOverlay, /"rabbithole_ego_browser"=\{enabled=true/);
  assert.ok(mcpOverlay.includes(JSON.stringify(egoExecutable)));
  assert.ok(mcpOverlay.includes(JSON.stringify(await fs.realpath(egoSkill))));
  assert.match((await threadCalls()).at(-1).developerInstructions, /EGO_BROWSER_SKILL_BODY/);
  assert.equal(codexLaunch.args.some((arg) => /web_search/.test(arg)), false);
  assert.equal(await fs.readFile(path.join(home, ".codex", "config.toml"), "utf8"), userConfig);
  const changedConfig = 'model_provider = "local"\n' + userConfig.replace('"cached"', '"live"')
    + '\n[model_providers.local]\nname = "Local provider"\nbase_url = "http://127.0.0.1:1234/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n';
  await fs.writeFile(path.join(home, ".codex", "config.toml"), changedConfig);
  await fs.rm(path.join(home, ".codex", "auth.json"));
  const previousToken = bridge.token;
  const unauthorizedRestart = await request(bridge, { method: "POST", pathname: "/bridge/restart", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(unauthorizedRestart.status, 401);
  const restarted = await request(bridge, { method: "POST", pathname: "/bridge/restart", headers: authHeaders(bridge, { "Content-Type": "application/json" }), body: "{}" });
  assert.equal(restarted.status, 200);
  assert.equal(restarted.json.ok, true);
  assert.equal(restarted.json.state.agents.find((agent) => agent.id === "codex").state, "ready");
  assert.equal(Object.hasOwn(restarted.json.state.agents.find((agent) => agent.id === "codex"), "plan"), false, "local providers need no OpenAI account or plan");
  const localModels = await request(bridge, { headers: authHeaders(bridge) });
  assert.equal(localModels.status, 200);
  assert.ok(localModels.json.data.some((model) => model.id === "codex/gpt-fake"), "local provider models remain selectable without login");
  assert.equal(bridge.token, previousToken);
  const launches = (await fs.readFile(codexArgsRecord, "utf8")).trim().split("\n").map((line) => JSON.parse(line)).filter((call) => call.args[0] === "app-server");
  assert.equal(launches.length, 2);
  assert.equal(launches.at(-1).config, changedConfig, "new CLI process reads updated user configuration");
  const afterRestart = await chat(bridge, { model: "codex/gpt-fake", messages: [{ role: "user", content: "After restart" }], stream: false });
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.json.choices[0].message.content, "OK");
  assert.equal(await fs.readFile(path.join(home, ".codex", "config.toml"), "utf8"), changedConfig);
  await assert.rejects(fs.access(path.join(home, ".codex", "auth.json")));
  await assert.rejects(fs.access(path.join(data, "codex-models.json")));
  await bridge.close();
  bridge = await createTestBridge();
  await bridge.start();
  await bridge.refreshState();
  const restartedProvider = createProvider({ preset: "subscriptions", base_url: `${bridge.url}/v1`, model: "codex/gpt-second", reasoning: "medium" }, bridge.token);
  const restartedHost = new DirectRabbitholeHost({ hole: saved.at(-1), provider: restartedProvider, store: { saveHole: async () => {} } });
  const restartedArticle = await ask(restartedHost, "restart-child", branchNode.id, "Ask after bridge restart");
  assert.equal(restartedArticle.extensions.codex_conversation.scopeId, rootConversation.scopeId);
  assert.equal((await turnCalls()).at(-1).model, "gpt-second", "new forks honor current model settings");
  assert.equal((await turnCalls()).at(-1).effort, "medium");
  assert.equal((await protocolCalls()).slice().reverse().find((call) => call.method === "thread/fork").params.threadId, branchConversation.threadId);
  assert.match(JSON.stringify((await turnCalls()).at(-1).inheritedHistory), /SEARCH branch/);
  await restartedHost.dispose();
} finally {
  await bridge?.close();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write("bridge http ok\n");
