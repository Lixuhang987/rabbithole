/** @protects bridge http capability contracts. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createProvider } from "../../src/web/provider/openai-compatible.js";
import { DirectRabbitholeHost, createPendingHoleFromQuestion } from "../../src/web/transport/direct-host.js";
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
const codexArgsRecord = path.join(temporaryRoot, "codex-args.ndjson");
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
  bridge = await createBridge({
    port: 0,
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: undefined,
      RABBITHOLE_DIR: data,
      RABBITHOLE_BRIDGE_CLAUDE_BIN: FAKE_CLAUDE,
      RABBITHOLE_BRIDGE_CODEX_BIN: FAKE_CODEX,
      FAKE_CLAUDE_RECORD: claudeRecord,
      FAKE_CODEX_RECORD: codexRecord,
      FAKE_CODEX_THREAD_RECORD: codexThreadRecord,
      FAKE_CODEX_APP_SERVER_ARGS: codexArgsRecord,
      CLAUDE_CONFIG_DIR: path.join(temporaryRoot, "must-not-be-used"),
    },
    version: "0.4.0-test",
    stateRefreshMs: 60_000,
  });
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
  assert.ok(codexLaunch.args.includes('mcp_servers={"user_server"={enabled=false}}'));
  assert.equal(codexLaunch.args.some((arg) => /web_search/.test(arg)), false);
  assert.equal(await fs.readFile(path.join(home, ".codex", "config.toml"), "utf8"), userConfig);
  const changedConfig = userConfig.replace('"cached"', '"live"');
  await fs.writeFile(path.join(home, ".codex", "config.toml"), changedConfig);
  const previousToken = bridge.token;
  const unauthorizedRestart = await request(bridge, { method: "POST", pathname: "/bridge/restart", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(unauthorizedRestart.status, 401);
  const restarted = await request(bridge, { method: "POST", pathname: "/bridge/restart", headers: authHeaders(bridge, { "Content-Type": "application/json" }), body: "{}" });
  assert.equal(restarted.status, 200);
  assert.equal(restarted.json.ok, true);
  assert.equal(restarted.json.state.agents.find((agent) => agent.id === "codex").state, "ready");
  assert.equal(bridge.token, previousToken);
  const launches = (await fs.readFile(codexArgsRecord, "utf8")).trim().split("\n").map((line) => JSON.parse(line)).filter((call) => call.args[0] === "app-server");
  assert.equal(launches.length, 2);
  assert.equal(launches.at(-1).config, changedConfig, "new CLI process reads updated user configuration");
  const afterRestart = await chat(bridge, { model: "codex/gpt-fake", messages: [{ role: "user", content: "After restart" }], stream: false });
  assert.equal(afterRestart.status, 200);
  assert.equal(afterRestart.json.choices[0].message.content, "OK");
  await assert.rejects(fs.access(path.join(data, "codex-models.json")));
} finally {
  await bridge?.close();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write("bridge http ok\n");
