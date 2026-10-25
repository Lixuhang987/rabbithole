/** @protects filesystem and authenticated HTTP store contracts and document host persistence. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { assertRabbitholeStore } from "../../src/core/store.js";
import { FsStore } from "../../src/node/bridge/store/fs-store.js";
import { DirectRabbitholeHost } from "../../src/web/transport/direct-host.js";
import { runStoreContract } from "../support/store-contract.mjs";
import { createStoreFixture } from "../support/backend-store.mjs";

if (typeof globalThis.FileReader !== "function") {
  (/** @type {any} */ (globalThis)).FileReader = class {
    constructor() {
      this.result = null;
      this.error = null;
      this.onload = null;
      this.onerror = null;
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload?.();
      }, (error) => {
        this.error = error;
        this.onerror?.();
      });
    }
  };
}

const fixture = await createStoreFixture();
const store = fixture.store;
try {
  const endpoint = `${fixture.bridge.url}/bridge/store/holes`;
  for (const { headers, expected } of [
    { headers: {}, expected: 401 },
    { headers: { Authorization: `Bearer ${fixture.bridge.token}`, Origin: "https://attacker.invalid" }, expected: 403 },
    { headers: { Authorization: `Bearer ${fixture.bridge.token}`, Origin: "http://localhost:9000" }, expected: 200 },
  ]) {
    const response = await fetch(endpoint, { headers });
    assert.equal(response.status, expected, "storage shares the bridge authentication and origin boundary");
  }
  const large = { hole_id: "large-hole", root_id: "root", nodes: [{ id: "root", markdown: "雪".repeat(1500000) }] };
  await store.saveHole(large);
  assert.equal((await store.loadHole("large-hole")).nodes[0].markdown, large.nodes[0].markdown, "full documents exceed the generic 4 MB JSON limit");
  await store.deleteHole("large-hole");
  for (const candidate of [new FsStore({ directory: fixture.directory }), store]) {
    assertRabbitholeStore(candidate);
    assert.deepEqual(await candidate.listHoles(), []);
    await runStoreContract(candidate, {
      readRawHole: async (id) => JSON.parse(await fs.readFile(path.join(fixture.directory, "documents", id, "hole.json"), "utf8")),
      writeRawHole: async (id, value) => {
        const folder = path.join(fixture.directory, "documents", id);
        await fs.mkdir(folder, { recursive: true });
        await fs.writeFile(path.join(folder, "hole.json"), JSON.stringify(value));
      },
      makeDeleteHost: async ({ root, childA, childB }) => {
        const host = new DirectRabbitholeHost({ store: candidate, hole: {
          hole_id: "gc-hole", title: "GC Hole", root_id: "root", created_at: "2026-01-01T00:00:00.000Z",
          view_state: null, nodes: [root, childA, childB],
        } });
        return { deleteNode: (id) => host.handleDeleteNode({ node_id: id }), close: () => host.flushSave() };
      },
    });
    await fs.rm(path.join(fixture.directory, "documents"), { recursive: true, force: true });
    await fs.rm(path.join(fixture.directory, "staging"), { recursive: true, force: true });
  }
{
  const registeredAssets = [];
  const revokedAssets = [];
  const host = new DirectRabbitholeHost({
    store,
    hole: {
      hole_id: "web-note-create",
      title: "Web note create",
      root_id: "root",
      created_at: "2026-08-11T00:00:00.000Z",
      view_state: null,
      nodes: [{ id: "root", parent_id: null, title: "Root", markdown: "Root body", status: "answered" }],
    },
    registerAssetUrl: (name, blob) => registeredAssets.push({ name, blob }),
    revokeAssetUrl: (name) => revokedAssets.push(name),
  });
  const result = await host.handleBrowserEvent({
    type: "node_create",
    id: "standalone-note",
    markdown: "Durable browser note",
    position: { x: -80, y: 220 },
    origin: { kind: "note" },
  });
  assert.deepEqual(result, { ok: true, node_id: "standalone-note" });
  assert.equal(host.hydration().nodes.find((node) => node.id === "standalone-note")?.parent_id, null, "web hydration includes standalone notes");
  assert.equal((await store.loadHole("web-note-create")).nodes.find((node) => node.id === "standalone-note")?.markdown, "Durable browser note", "web node_create must persist to the backend before returning");

  await host.handleBrowserEvent({ type: "delete_node", node_id: "standalone-note" });
  await host.flushSave();
  assert.equal((await store.loadHole("web-note-create")).nodes.some((node) => node.id === "standalone-note"), false, "web host deletes and persists standalone notes");

  const pastedBlob = new Blob([Uint8Array.of(1, 2, 3)], { type: "image/png" });
  assert.deepEqual(await host.adapter().putAsset("paste-web.png", pastedBlob), { ok: true, name: "paste-web.png" });
  assert.equal(registeredAssets[0].name, "paste-web.png", "the BYOK upload seam registers an immediately renderable URL");
  assert.deepEqual((await store.getAssets("web-note-create")).map(({ name, blob }) => [name, blob.size]),
    [["paste-web.png", pastedBlob.size]], "the browser store can lease all Blob handles in one store call");
  await store.putAssets("web-note-create", [
    { name: "paste-batch-a.png", blob: pastedBlob },
    { name: "paste-batch-b.png", bytes: Uint8Array.of(4, 5) },
  ]);
  assert.deepEqual(
    (await store.getAssets("web-note-create"))
      .filter(({ name }) => name.startsWith("paste-batch-"))
      .map(({ name, blob }) => [name, blob.size]),
    [["paste-batch-a.png", 3], ["paste-batch-b.png", 2]],
    "the browser store can persist multiple assets in one store call",
  );
  await assert.rejects(() => host.adapter().putAsset("figure.png", pastedBlob), /start with paste-/);
  await assert.rejects(() => host.adapter().putAsset("paste-web.png", pastedBlob), /already exists/);

  for (let index = 1; index <= 5; index += 1) {
    await store.putAsset("web-note-create", `paste-delivery-${index}.png`, pastedBlob);
  }
  const deliveryContext = {};
  await host.attachBranchImage({ parent_id: "root", origin: { attachment_assets: [
    "../escape.png", "paste-web.png", "paste-delivery-1.png", "paste-delivery-2.png",
    "paste-delivery-3.png", "paste-delivery-4.png", "paste-delivery-5.png",
  ] } }, deliveryContext);
  assert.deepEqual(deliveryContext.attachments.map((attachment) => attachment.name),
    ["paste-web.png", "paste-delivery-1.png", "paste-delivery-2.png", "paste-delivery-3.png"],
    "BYOK delivery keeps valid image asset names and caps persisted attachments at four");
  const askResult = await host.handleBrowserEvent({
    type: "branch_request",
    request_id: "standalone-away-request",
    node_id: "standalone-away-ask",
    parent_id: null,
    selected_text: "",
    question: "Can this wait for a provider?",
    branch_type: "followup",
    position: { x: 180, y: -60 },
    size: { w: 300, h: 180 },
    attachment_assets: ["paste-web.png", "../bad.png"],
  });
  assert.deepEqual(askResult, {
    ok: true, node_id: "standalone-away-ask", request_id: "standalone-away-request",
  });
  const savedAsk = (await store.loadHole("web-note-create")).nodes.find((node) => node.id === "standalone-away-ask");
  assert.equal(savedAsk.parent_id, null, "a BYOK ask is durably disconnected before provider work starts");
  assert.equal(savedAsk.status, "pending", "a standalone ask remains saved while no provider is available");
  assert.equal(savedAsk.origin.question, "Can this wait for a provider?");
  assert.deepEqual(savedAsk.origin.attachment_assets, ["paste-web.png"], "the BYOK branch chokepoint keeps only durable image asset names");
  assert.deepEqual(savedAsk.position, { x: 180, y: -60 });
  assert.deepEqual(savedAsk.size, { w: 300, h: 180 });
  assert.deepEqual(await host.adapter().deleteAsset("paste-web.png"), { ok: true, name: "paste-web.png" });
  assert.equal(await store.getAsset("web-note-create", "paste-web.png"), null);
  assert.deepEqual(revokedAssets, ["paste-web.png"], "the BYOK delete seam must revoke the registered live URL");
  await assert.rejects(() => host.adapter().deleteAsset("figure.png"), /pasted image assets/);
  await host.dispose();
}
console.log("ok the backend parentless nodes: standalone notes and away asks persist with null graph parents");


} finally { await fixture.close(); }
