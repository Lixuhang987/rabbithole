import { getAssetContentType, validateAssetName } from "../../core/assets.js";
import { parsePersistedHole } from "../../core/schema.js";
import { assertSafeHoleId, assertSafeIngestId } from "../../core/store.js";
import { bridgeRootUrl } from "../provider/bridge-catalog.js";
import { addressSpaceHint } from "../provider/network.js";

/** The paired bridge is the sole document store. Connection identity is fixed. */
export class HttpStore {
  constructor({ base_url, token }) {
    this.baseUrl = bridgeRootUrl(base_url);
    this.token = token;
  }

  /** @param {string} route @param {{body?: any, binary?: boolean, name?: string}} [options] */
  async request(route, { body, binary = false, name = "" } = {}) {
    const url = `${this.baseUrl}/bridge/store${route}`;
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "Content-Type": binary ? getAssetContentType(name) : "application/json" }) },
      ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }),
      ...addressSpaceHint(url),
    });
    if (binary && body === undefined && response.status === 404) return null;
    if (!response.ok) {
      const payload = await response.json();
      const error = new Error(payload.error?.message || `Document storage failed (HTTP ${response.status}).`);
      Object.assign(error, { status: response.status });
      throw error;
    }
    return binary && body === undefined ? response.blob() : response.json();
  }

  holePath(holeId) { return `/holes/${assertSafeHoleId(holeId)}`; }
  assetPath(holeId, name) { return `${this.holePath(holeId)}/assets/${validateAssetName(name)}`; }
  stagingPath(ingestId) { return `/staging/${assertSafeIngestId(ingestId)}`; }

  async listHoles() { return this.request("/holes"); }
  async loadHole(holeId) {
    const hole = await this.request(this.holePath(holeId));
    return hole === null ? null : parsePersistedHole(hole, { clone: false });
  }
  async saveHole(hole, options = {}) { await this.request(this.holePath(hole?.hole_id), { body: { hole, options } }); }
  async deleteHole(holeId) { await this.request(`${this.holePath(holeId)}/delete`, { body: {} }); }
  async listAssets(holeId) { return this.request(`${this.holePath(holeId)}/assets`); }
  async getAsset(holeId, name) { return this.request(this.assetPath(holeId, name), { binary: true }); }
  async putAsset(holeId, name, bytes) { await this.request(this.assetPath(holeId, name), { body: bytes, binary: true, name }); }
  async deleteAsset(holeId, name) { await this.request(`${this.assetPath(holeId, name)}/delete`, { body: {} }); }
  async getAssets(holeId) {
    return Promise.all((await this.listAssets(holeId)).map(async (name) => ({ name, blob: await this.getAsset(holeId, name) })));
  }
  async putAssets(holeId, assets) {
    const results = await Promise.allSettled(assets.map((asset) => this.putAsset(holeId, asset.name, asset.blob ?? asset.bytes)));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }
  async createStaging() { return this.request("/staging", { body: {} }); }
  async putStagedAsset(ingestId, name, bytes) {
    await this.request(`${this.stagingPath(ingestId)}/assets/${validateAssetName(name)}`, { body: bytes, binary: true, name });
  }
  async adoptStagedAssets(holeId, ingestId) {
    return this.request(`${this.stagingPath(ingestId)}/adopt`, { body: { hole_id: assertSafeHoleId(holeId) } });
  }
  async discardStaging(ingestId) { await this.request(`${this.stagingPath(ingestId)}/discard`, { body: {} }); }
}
