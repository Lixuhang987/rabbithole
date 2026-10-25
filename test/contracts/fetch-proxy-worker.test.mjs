/** @protects fetch proxy worker capability contracts. */
import assert from "node:assert/strict";
import { ALLOWED_HOSTS, handleFetchProxyRequest, MAX_RESPONSE_BYTES } from "../../workers/fetch-proxy/index.js";
import { webContentSecurityPolicy } from "../../policy/csp.js";
import { FETCH_PROXY_ALLOWED_HOSTS, WEB_CONNECT_SOURCES } from "../../policy/origins.js";

await rejectsNonGet();
await rejectsUnallowlistedHost();
await stripsCookieAndAuthHeaders();
await enforcesStreamingSizeCap();
policyListsStayDistinct();

console.log("fetch proxy worker verification passed");

async function rejectsNonGet() {
  const res = await handleFetchProxyRequest(new Request("https://proxy.test/?url=https://arxiv.org/abs/1706.03762", {
    method: "POST",
  }));
  assert.equal(res.status, 405);
}

async function rejectsUnallowlistedHost() {
  const res = await handleFetchProxyRequest(new Request("https://proxy.test/?url=https://example.com/"));
  assert.equal(res.status, 400);
  assert.match(await res.text(), /not allowlisted/);
}

async function stripsCookieAndAuthHeaders() {
  let upstreamRequest = null;
  const res = await handleFetchProxyRequest(new Request("https://proxy.test/?url=https://arxiv.org/abs/1706.03762", {
    headers: {
      Origin: "https://app.example",
      Cookie: "session=secret",
      Authorization: "Bearer secret",
    },
  }), {
    upstreamFetch: async (request) => {
      upstreamRequest = request;
      return new Response("<article>ok</article>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": "upstream=secret",
          "www-authenticate": "Basic realm=test",
        },
      });
    },
  });

  assert(upstreamRequest);
  const capturedRequest = /** @type {Request} */ (upstreamRequest);
  assert.equal(capturedRequest.headers.get("cookie"), null);
  assert.equal(capturedRequest.headers.get("authorization"), null);
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(res.headers.get("www-authenticate"), null);
  assert.equal(res.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(res.headers.get("access-control-allow-origin"), "https://app.example");
  assert.equal(await res.text(), "<article>ok</article>");
}

async function enforcesStreamingSizeCap() {
  const res = await handleFetchProxyRequest(new Request("https://proxy.test/?url=https://openreview.net/forum?id=test"), {
    upstreamFetch: async () => new Response(oversizeStream(), {
      headers: { "content-type": "application/octet-stream" },
    }),
  });
  assert.equal(res.status, 200);
  await assert.rejects(() => res.arrayBuffer(), /25 MB proxy limit/);
}

function oversizeStream() {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      sent += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
      if (sent > Math.ceil(MAX_RESPONSE_BYTES / (1024 * 1024)) + 2) controller.close();
    },
  });
}

function policyListsStayDistinct() {
  assert.deepEqual([...ALLOWED_HOSTS], [...FETCH_PROXY_ALLOWED_HOSTS]);
  assert(WEB_CONNECT_SOURCES.includes("https:"));
  assert(WEB_CONNECT_SOURCES.includes("http://127.0.0.1:*"));
  assert(!FETCH_PROXY_ALLOWED_HOSTS.includes("localhost"));
  assert.notDeepEqual(WEB_CONNECT_SOURCES, FETCH_PROXY_ALLOWED_HOSTS);
  const csp = webContentSecurityPolicy({
    canonicalHostScript: "canonical();",
    initialThemeScript: "theme();",
  });
  assert.match(csp, /script-src 'self' 'sha256-/);
  assert.match(csp, /connect-src [^;]*https: [^;]*http:/);
  assert.doesNotMatch(csp, /default-src[^;]*unsafe-inline/);
}
