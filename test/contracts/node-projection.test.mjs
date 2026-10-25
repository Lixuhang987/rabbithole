/** @protects node projection capability contracts. */
import assert from "node:assert/strict";
import { askOfNode, validateAsk } from "../../src/core/hole/ask.js";
import { FIELDS, makeNode, projectNode } from "../../src/core/hole/node.js";
import { createHoleState, holeStateToHole, reduceHoleEvent } from "../../src/core/hole/reduce.js";
import { parsePersistedHole, toPersistedHole, validatePersistedHole } from "../../src/core/schema.js";

const legacyNode = {
  id: "child",
  parent_id: "root",
  title: "Why?",
  markdown: "Answer",
  base_url: "https://example.test/docs/",
  base_url_source: "inherited",
  origin: {
    selected_text: "source",
    question: "Why?",
    lens: "deeper",
    anchor: { offset_start: 2, offset_end: 8 },
    branch_type: "selection",
    attachment_assets: ["paste-one.png"],
  },
  position: { x: 12, y: -4 },
  size: { w: 420, h: 460 },
  font_scale: 1.1,
  collapsed: false,
  status: "answered",
  read: true,
  created_at: "2026-08-29T00:00:00.000Z",
  extensions: {
    canvas: { pin: { x: 2, y: 3 } },
    note: { docked: true },
    learn: { block: { revealed: true } },
    third_party: { kept: true },
  },
};

const node = makeNode(legacyNode);
assert.deepEqual(Object.keys(node), Object.keys(FIELDS), "makeNode is driven by the one FIELDS declaration");
assert.deepEqual(node.view, { pin: { x: 2, y: 3 }, docked: true });
assert.deepEqual(node.progress, legacyNode.extensions.learn);
assert.deepEqual(node.extensions, { third_party: { kept: true } });

const expectedKeys = (target) => Object.entries(FIELDS)
  .filter(([, descriptor]) => descriptor.targets.includes(target))
  .map(([name]) => name)
  .filter((name) => !["source", "view", "progress"].includes(name));

/** @type {Array<"persist" | "hydrate" | "wire" | "portable" | "snapshot">} */
const targets = ["persist", "hydrate", "wire", "portable", "snapshot"];
for (const target of targets) {
  const projection = projectNode(node, target);
  assert.deepEqual(Object.keys(projection), expectedKeys(target), `${target} projection follows FIELDS targets exactly`);
  assert.equal(projection.id, node.id);
  assert.deepEqual(projection.position, node.position);
  assert.deepEqual(projection.size, node.size);
}

/** @type {Array<"persist" | "hydrate" | "portable">} */
const roundTripTargets = ["persist", "hydrate", "portable"];
for (const target of roundTripTargets) {
  assert.deepEqual(projectNode(node, target).extensions, legacyNode.extensions, `${target} round-trips all schema-v2 namespaces`);
}
assert.deepEqual(projectNode(node, "snapshot").extensions, {
  canvas: legacyNode.extensions.canvas,
  note: legacyNode.extensions.note,
}, "snapshot projection keeps page-shaping namespaces and defaults all others private");
assert.equal(Object.hasOwn(projectNode(node, "wire"), "extensions"), false);

const persisted = toPersistedHole({
  hole_id: "projection-contract",
  title: "Projection contract",
  root_id: "child",
  created_at: null,
  view_state: null,
  nodes: [node],
}, { updatedAt: "2026-08-29T00:00:01.000Z" });
assert.equal(validatePersistedHole(persisted), true);
assert.deepEqual(parsePersistedHole(persisted), persisted);
assert.deepEqual(makeNode(persisted.nodes[0]), node, "schema-v2 persistence rehydrates the canonical Node without field drift");

const ask = askOfNode(node);
assert.ok(ask);
assert.strictEqual(validateAsk(ask), ask);
assert.deepEqual(ask.at, { node_id: "root", anchor: { offset_start: 2, offset_end: 8 } });
assert.deepEqual(ask.attachments, ["paste-one.png"]);
assert.equal(ask.state, "settled");

let state = createHoleState({ root_id: "root", nodes: [
  { id: "root", parent_id: null, title: "Root", markdown: "Root" },
] });
state = reduceHoleEvent(state, {
  type: "branch_request", parent_id: "root", node_id: "pending", question: "What next?",
}, { now: "2026-08-29T00:00:02.000Z" }).state;
assert.equal(state.asks.get("pending").state, "requested");
state = reduceHoleEvent(state, {
  type: "node_progress", node_id: "pending", markdown: "Working", run: { id: "run-1", seq: 1 },
}).state;
assert.deepEqual(state.asks.get("pending").run, { id: "run-1", seq: 1 });
assert.equal(state.asks.get("pending").state, "streaming");
state = reduceHoleEvent(state, { type: "node_answered", node_id: "pending", markdown: "Done", title: "Done" }).state;
assert.equal(state.asks.get("pending").state, "settled");
assert.equal(holeStateToHole(state).asks, undefined, "Ask is canonical engine state, not a schema-v2 wire change");

let extensionState = createHoleState({ root_id: "child", nodes: [makeNode(legacyNode)] }, { canonicalNodes: true });
extensionState = reduceHoleEvent(extensionState, {
  type: "node_extensions_patch", node_id: "child", namespace: "canvas", value: {},
}).state;
assert.deepEqual(extensionState.nodes.get("child").view, { docked: true },
  "a canvas namespace replacement removes omitted fields while preserving note presentation");
assert.deepEqual(holeStateToHole(extensionState).nodes[0].extensions, {
  note: legacyNode.extensions.note,
  learn: legacyNode.extensions.learn,
  third_party: legacyNode.extensions.third_party,
}, "removing a canonical canvas field survives the schema-v2 projection");

const oldPersisted = {
  schema_version: 2,
  hole_id: "old-file",
  title: "Old file",
  root_id: "root",
  created_at: null,
  updated_at: null,
  view_state: { mode: "reader", node_id: "root", scroll: 9 },
  nodes: [{ ...projectNode(makeNode({ id: "root" }), "persist"), origin: { web_root_question: "Old question" } }],
};
assert.equal(parsePersistedHole(oldPersisted).nodes[0].origin.web_root_question, "Old question");
console.log("ok node projection: one field table, five targets, canonical Ask lifecycle, and schema-v2 compatibility");
