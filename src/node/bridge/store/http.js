import { getAssetContentType, maxAssetBytes, validateAssetName } from "../../../core/assets.js";
import { parseRequestBody } from "../../shared/http.js";
import { BridgeError } from "../errors.js";

async function assetBody(req, name) {
  const limit = maxAssetBytes(validateAssetName(name));
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new BridgeError("Asset exceeds the size limit.", "turn_failed", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Authenticated storage routes. JSON values and binary bytes remain separate. */
export async function handleStoreRequest(req, res, url, store, sendJson) {
  const parts = url.pathname.slice("/bridge/store/".length).split("/").map(decodeURIComponent);
  const [kind, id, action, name, operation] = parts;
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    if (kind === "holes" && parts.length === 1) return sendJson(res, 200, await store.listHoles());
    if (kind === "holes" && parts.length === 2) return sendJson(res, 200, await store.loadHole(id));
    if (kind === "holes" && action === "assets" && parts.length === 3) return sendJson(res, 200, await store.listAssets(id));
    if (kind === "holes" && action === "assets" && parts.length === 4) {
      const bytes = await store.getAsset(id, name);
      if (!bytes) return sendJson(res, 404, { error: { code: "turn_failed", message: "Asset not found." } });
      res.writeHead(200, { "Content-Type": getAssetContentType(name), "Content-Length": bytes.length });
      res.end(bytes);
      return;
    }
  }

  if (req.method === "POST") {
    if ((kind === "holes" || kind === "staging") && action === "assets" && parts.length === 4) {
      const bytes = await assetBody(req, name);
      if (kind === "holes") await store.putAsset(id, name, bytes);
      else await store.putStagedAsset(id, name, bytes);
      return sendJson(res, 200, { ok: true });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers["content-type"] || ""))) {
      throw new BridgeError("Content-Type must be application/json.", "unsupported_media_type", 415);
    }
    const body = await parseRequestBody(req, { maxBytes: Infinity });
    if (kind === "holes" && parts.length === 2) {
      if (body.hole?.hole_id !== id) throw new BridgeError("Document id does not match its URL.", "turn_failed", 400);
      await store.saveHole(body.hole, body.options);
    } else if (kind === "holes" && action === "delete" && parts.length === 3) {
      await store.deleteHole(id);
    } else if (kind === "holes" && action === "assets" && operation === "delete" && parts.length === 5) {
      await store.deleteAsset(id, name);
    } else if (kind === "staging" && parts.length === 1) {
      return sendJson(res, 200, await store.createStaging());
    } else if (kind === "staging" && action === "adopt" && parts.length === 3) {
      return sendJson(res, 200, await store.adoptStagedAssets(body.hole_id, id));
    } else if (kind === "staging" && action === "discard" && parts.length === 3) {
      await store.discardStaging(id);
    } else {
      throw new BridgeError("Route not found.", "turn_failed", 404);
    }
    return sendJson(res, 200, { ok: true });
  }
  throw new BridgeError("Route not found.", "turn_failed", 404);
}
