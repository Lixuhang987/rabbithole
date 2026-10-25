import { FETCH_PROXY_ALLOWED_HOSTS } from "../../policy/origins.js";

export const ALLOWED_HOSTS = new Set(FETCH_PROXY_ALLOWED_HOSTS);

export const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export default {
  fetch(request, env = {}) {
    return handleFetchProxyRequest(request, {
      upstreamFetch: env.upstreamFetch || globalThis.fetch,
      appOrigin: env.APP_ORIGIN || env.appOrigin || "",
    });
  },
};

export async function handleFetchProxyRequest(request, {
  upstreamFetch = globalThis.fetch,
  appOrigin = "",
} = {}) {
  const cors = corsHeaders(request, appOrigin);
  if (request.method !== "GET") {
    return textResponse("Only GET is supported.", 405, cors);
  }

  let target;
  try {
    const url = new URL(request.url);
    target = new URL(url.searchParams.get("url") || "");
    validateTargetUrl(target);
  } catch (err) {
    return textResponse(err instanceof Error ? err.message : "Invalid URL.", 400, cors);
  }

  let upstreamResponse;
  try {
    upstreamResponse = await fetchAllowed(target, { upstreamFetch, redirects: MAX_REDIRECTS });
  } catch (err) {
    return textResponse(err instanceof Error ? err.message : "Upstream fetch failed.", 502, cors);
  }

  const headers = responseHeaders(upstreamResponse.headers, cors);
  const contentLength = Number(upstreamResponse.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    return textResponse("Upstream response exceeds the 25 MB proxy limit.", 413, cors);
  }

  if (!upstreamResponse.body) {
    const bytes = new Uint8Array(await upstreamResponse.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      return textResponse("Upstream response exceeds the 25 MB proxy limit.", 413, cors);
    }
    return new Response(bytes, { status: upstreamResponse.status, headers });
  }

  return new Response(capStream(upstreamResponse.body, MAX_RESPONSE_BYTES), {
    status: upstreamResponse.status,
    headers,
  });
}

async function fetchAllowed(target, { upstreamFetch, redirects }) {
  validateTargetUrl(target);
  const response = await upstreamFetch(new Request(target.href, {
    method: "GET",
    redirect: "manual",
    headers: upstreamRequestHeaders(),
  }));

  if (isRedirect(response.status)) {
    if (redirects <= 0) throw new Error("Too many upstream redirects.");
    const location = response.headers.get("location");
    if (!location) throw new Error("Upstream redirect omitted Location.");
    const next = new URL(location, target);
    validateTargetUrl(next);
    return fetchAllowed(next, { upstreamFetch, redirects: redirects - 1 });
  }

  return response;
}

function validateTargetUrl(url) {
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Only http and https URLs are supported.");
  }
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error(`Host is not allowlisted: ${url.hostname}`);
  }
}

function upstreamRequestHeaders() {
  return new Headers({
    Accept: "text/html,text/plain;q=0.5,*/*;q=0.1",
  });
}

function responseHeaders(upstreamHeaders, cors) {
  const headers = new Headers(cors);
  const contentType = upstreamHeaders.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("cache-control", "no-store");
  return headers;
}

function corsHeaders(request, appOrigin) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = appOrigin || origin || "*";
  return {
    "access-control-allow-origin": allowedOrigin,
    "access-control-allow-methods": "GET",
    "access-control-allow-headers": "content-type, accept",
    "vary": "Origin",
  };
}

function capStream(body, maxBytes) {
  const reader = body.getReader();
  let total = 0;
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("response too large").catch(() => {});
        controller.error(new Error("Upstream response exceeds the 25 MB proxy limit."));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function textResponse(text, status, headers) {
  return new Response(text, {
    status,
    headers: {
      ...headers,
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function isRedirect(status) {
  return status >= 300 && status < 400;
}
