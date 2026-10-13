import http from "node:http";
import https from "node:https";
import { randomBytes } from "node:crypto";
import { parseRequestBody } from "../../shared/http.js";

function forwardingHeaders(source) {
  const headers = { ...source };
  const connection = String(headers.connection || "").split(",");
  for (const name of [...connection, "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]) {
    delete headers[name.trim().toLowerCase()];
  }
  return headers;
}

/** Private, fixed-upstream transport. roots maps native thread IDs to cache identities. */
export async function createCodexCacheProxy({ upstream, roots }) {
  const targetBase = new URL(upstream);
  if (!["http:", "https:"].includes(targetBase.protocol)) throw new Error("Codex provider requires an HTTP endpoint.");
  const prefix = "/" + randomBytes(32).toString("hex");
  const sockets = new Set();
  const outgoing = new Set();
  let baseUrl;
  let closed = false;
  const server = http.createServer(async (req, res) => {
    let request;
    const disconnect = () => { request?.destroy(); };
    res.once("close", disconnect);
    req.on("error", disconnect);
    try {
      if (closed || req.headers.origin !== undefined || req.headers.host !== new URL(baseUrl).host || !req.url?.startsWith(prefix + "/")) {
        res.writeHead(403).end();
        req.resume();
        return;
      }
      const suffix = req.url.slice(prefix.length);
      const target = new URL(targetBase);
      const relative = new URL(suffix, "http://localhost");
      target.pathname = targetBase.pathname.replace(/\/$/, "") + relative.pathname;
      for (const [key, value] of relative.searchParams) target.searchParams.append(key, value);
      const headers = forwardingHeaders(req.headers);
      headers.host = target.host;
      let payload;
      if (req.method === "POST" && /^\/responses(?:\/compact)?$/.test(relative.pathname)) {
        const root = roots.get(req.headers["thread-id"]);
        if (!root) {
          res.writeHead(409, { "Content-Type": "application/json" }).end('{"error":{"message":"Unknown Codex cache lineage"}}');
          req.resume();
          return;
        }
        if (headers["content-encoding"]) {
          res.writeHead(415).end();
          req.resume();
          return;
        }
        const body = await parseRequestBody(req, { maxBytes: Infinity });
        body.prompt_cache_key = root;
        payload = Buffer.from(JSON.stringify(body));
        headers["session-id"] = root;
        headers["content-length"] = String(payload.length);
      }
      if (res.destroyed || closed) return;
      request = (target.protocol === "https:" ? https : http).request(target, { method: req.method, headers }, (response) => {
        response.on("error", () => res.destroy());
        res.writeHead(response.statusCode, forwardingHeaders(response.headers));
        response.pipe(res);
      });
      outgoing.add(request);
      request.once("close", () => outgoing.delete(request));
      request.on("error", () => {
        if (res.destroyed) return;
        if (res.headersSent) res.destroy();
        else res.writeHead(502, { "Content-Type": "application/json" }).end('{"error":{"message":"Codex provider transport failed"}}');
      });
      if (payload) request.end(payload);
      else req.pipe(request);
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) res.destroy();
      else res.writeHead(error.statusCode || 502).end();
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(undefined); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Codex proxy failed to bind.");
  baseUrl = `http://127.0.0.1:${address.port}${prefix}`;
  let closing;
  return {
    baseUrl,
    close() {
      if (!closing) {
        closed = true;
        for (const request of outgoing) request.destroy();
        for (const socket of sockets) socket.destroy();
        closing = new Promise((resolve) => server.close(() => resolve(undefined)));
      }
      return closing;
    },
  };
}
