/** @protects private Codex cache affinity transport, streaming and lifecycle. */
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createCodexCacheProxy } from "../../src/node/bridge/agents/codex-cache-proxy.js";

const captured = [];
let disconnected;
const upstream = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();
  captured.push({ headers: req.headers, url: req.url, body: body && JSON.parse(body) });
  if (req.url.includes("/slow")) {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write("data: first\n\n");
    res.on("close", () => disconnected?.());
  } else if (req.url.includes("/error")) {
    res.writeHead(429, { "Retry-After": "7" });
    res.end('{"error":{"message":"rate limited"}}');
  } else {
    res.writeHead(200, { "Content-Type": "text/event-stream", "X-Upstream": "kept" });
    res.write("data: 文\n\n");
    res.end("data: [DONE]\n\n");
  }
});
upstream.listen(0, "127.0.0.1");
await once(upstream, "listening");
const roots = new Map([["child-a", "root-a"], ["child-b", "root-b"]]);
const proxy = await createCodexCacheProxy({ upstream: `http://127.0.0.1:${upstream.address().port}/custom/v1`, roots });
const post = (id, extra = {}) => fetch(proxy.baseUrl + "/responses?api-version=test", {
  method: "POST", headers: { "Content-Type": "application/json", "Session-Id": id, "Thread-Id": id, Authorization: "Bearer offline", "X-Codex-Turn-Metadata": id },
  body: JSON.stringify({ input: "文".repeat(6 * 1024 * 1024), prompt_cache_key: id, ...extra }),
});
try {
  const responses = await Promise.all([post("child-a"), post("child-b")]);
  for (const response of responses) {
    assert.equal(response.headers.get("x-upstream"), "kept");
    assert.equal(await response.text(), "data: 文\n\ndata: [DONE]\n\n");
  }
  for (const request of captured) {
    const id = request.headers["thread-id"];
    assert.equal(request.headers["session-id"], roots.get(id));
    assert.equal(request.body.prompt_cache_key, roots.get(id));
    assert.equal(request.body.input.length, 6 * 1024 * 1024);
    assert.equal(request.headers["x-codex-turn-metadata"], id);
    assert.equal(request.headers.authorization, "Bearer offline");
    assert.equal(request.url, "/custom/v1/responses?api-version=test");
    assert.equal(Number(request.headers["content-length"]), Buffer.byteLength(JSON.stringify(request.body)));
  }
  const denied = await fetch(proxy.baseUrl + "/responses", { method: "POST", headers: { Origin: "https://example.com" }, body: "{}" });
  assert.equal(denied.status, 403);
  assert.equal((await fetch(new URL("/responses", proxy.baseUrl))).status, 403);
  assert.equal((await post("unknown")).status, 409);
  assert.equal(captured.length, 2, "only authorized registered threads reach upstream");
  const error = await fetch(proxy.baseUrl + "/error");
  assert.equal(error.status, 429);
  assert.equal(error.headers.get("retry-after"), "7");
  assert.equal(await error.text(), '{"error":{"message":"rate limited"}}');
  const abort = new AbortController();
  const slow = await fetch(proxy.baseUrl + "/slow", { signal: abort.signal });
  const reader = slow.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /first/);
  const closed = new Promise((resolve) => { disconnected = resolve; });
  abort.abort();
  await closed;
  const shutdown = await fetch(proxy.baseUrl + "/slow");
  await shutdown.body.getReader().read();
  const shutdownClosed = new Promise((resolve) => { disconnected = resolve; });
  await proxy.close();
  await shutdownClosed;
  console.log("private cache proxy: independent families, large UTF-8, SSE, errors, cancel and shutdown ok");
} finally {
  await proxy.close();
  upstream.closeAllConnections();
  await new Promise((resolve) => upstream.close(resolve));
}
