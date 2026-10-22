import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { maxAssetBytes, validateAssetName } from "../../../core/assets.js";
import { CURRENT_SCHEMA_VERSION, parsePersistedHole, toPersistedHole } from "../../../core/schema.js";
import { assertSafeHoleId, assertSafeIngestId, createIngestId, holeSummary } from "../../../core/store.js";
import { errorCode } from "../../shared/errno.js";

async function names(directory) {
  try { return (await fs.readdir(directory)).sort(); }
  catch (error) { if (errorCode(error) === "ENOENT") return []; throw error; }
}

async function readFile(filename) {
  try { return await fs.readFile(filename); }
  catch (error) { if (errorCode(error) === "ENOENT") return null; throw error; }
}

/** Local document persistence; native Codex history has a separate owner. */
export class FsStore {
  constructor({ directory }) {
    this.documents = path.join(directory, "documents");
    this.staging = path.join(directory, "staging");
  }

  holeDirectory(holeId) { return path.join(this.documents, assertSafeHoleId(holeId)); }
  stagingDirectory(ingestId) { return path.join(this.staging, assertSafeIngestId(ingestId)); }

  async listHoles() {
    const holes = await Promise.all((await names(this.documents)).map((id) => this.loadHole(id)));
    return holes.filter(Boolean).map(holeSummary).sort((a, b) =>
      String(b.updated_at || "").localeCompare(String(a.updated_at || "")) || a.hole_id.localeCompare(b.hole_id));
  }

  async loadHole(holeId) {
    const bytes = await readFile(path.join(this.holeDirectory(holeId), "hole.json"));
    return bytes ? parsePersistedHole(JSON.parse(bytes.toString("utf8")), { clone: false }) : null;
  }

  async saveHole(hole, options = {}) {
    const directory = this.holeDirectory(hole?.hole_id);
    if (hole?.schema_version !== undefined && hole.schema_version !== CURRENT_SCHEMA_VERSION) parsePersistedHole(hole);
    const persisted = toPersistedHole(hole, options);
    await fs.mkdir(directory, { recursive: true });
    const temporary = path.join(directory, `hole-${randomUUID()}.tmp`);
    await fs.writeFile(temporary, JSON.stringify(persisted));
    await fs.rename(temporary, path.join(directory, "hole.json"));
  }

  async deleteHole(holeId) { await fs.rm(this.holeDirectory(holeId), { recursive: true, force: true }); }
  async listAssets(holeId) { return names(path.join(this.holeDirectory(holeId), "assets")); }

  async getAsset(holeId, name) {
    return readFile(path.join(this.holeDirectory(holeId), "assets", validateAssetName(name)));
  }

  async putAsset(holeId, name, bytes) {
    const directory = path.join(this.holeDirectory(holeId), "assets");
    const safeName = validateAssetName(name);
    const data = await assetBytes(bytes, safeName);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, safeName), data);
  }

  async deleteAsset(holeId, name) {
    await fs.rm(path.join(this.holeDirectory(holeId), "assets", validateAssetName(name)), { force: true });
  }

  async getAssets(holeId) {
    return Promise.all((await this.listAssets(holeId)).map(async (name) => ({ name, blob: await this.getAsset(holeId, name) })));
  }

  async putAssets(holeId, assets) {
    const results = await Promise.allSettled(assets.map((asset) => this.putAsset(holeId, asset.name, asset.blob ?? asset.bytes)));
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }

  async createStaging() {
    const ingest_id = createIngestId();
    await fs.mkdir(this.stagingDirectory(ingest_id), { recursive: true });
    return { ingest_id };
  }

  async putStagedAsset(ingestId, name, bytes) {
    const filename = path.join(this.stagingDirectory(ingestId), validateAssetName(name));
    await fs.writeFile(filename, await assetBytes(bytes, name));
  }

  async adoptStagedAssets(holeId, ingestId) {
    const destination = path.join(this.holeDirectory(holeId), "assets");
    const source = this.stagingDirectory(ingestId);
    const assets = await names(source);
    if (!assets.length) throw new Error(`Unknown ingest_id ${JSON.stringify(ingestId)}; restart the PDF import.`);
    await fs.mkdir(destination, { recursive: true });
    for (const name of assets) await fs.rename(path.join(source, validateAssetName(name)), path.join(destination, name));
    await fs.rmdir(source);
    return assets;
  }

  async discardStaging(ingestId) { await fs.rm(this.stagingDirectory(ingestId), { recursive: true, force: true }); }
}

async function assetBytes(bytes, name) {
  const data = bytes instanceof Blob ? Buffer.from(await bytes.arrayBuffer())
    : bytes instanceof ArrayBuffer ? Buffer.from(bytes)
      : bytes instanceof Uint8Array ? Buffer.from(bytes) : null;
  if (!data) throw new Error("asset bytes must be a Blob, ArrayBuffer, or Uint8Array");
  const limit = maxAssetBytes(name);
  if (data.length > limit) throw new Error(`asset bytes exceeds ${Math.round(limit / 1024 / 1024)} MB`);
  return data;
}
