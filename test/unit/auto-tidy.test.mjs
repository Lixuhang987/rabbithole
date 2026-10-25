/** @protects auto-tidy branch selection and preference capability contracts. */
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = {
  get length() {
    return store.size;
  },
  clear: () => store.clear(),
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  key: (index) => Array.from(store.keys())[index] ?? null,
  removeItem: (key) => {
    store.delete(key);
  },
  setItem: (key, value) => {
    store.set(key, String(value));
  },
};

const { computeRibs, decideAutoTidyFolds, retimeRibs } = await import("../../src/ui/canvas/auto-tidy-policy.js");
const { makeNode, nodeNeedsReading } = await import("../../src/core/hole/node.js");
const { createHoleState, holeStateToHole, reduceHoleEvent } = await import("../../src/core/hole/reduce.js");
const { formatAutoTidyGrace } = await import("../../src/ui/canvas-settings.js");
const {
  AUTO_TIDY_GRACE_DEFAULT,
  autoTidyEnabled,
  autoTidyGraceSeconds,
  clampAutoTidyGraceSeconds,
  onPreferenceChange,
  setAutoTidyEnabled,
  setAutoTidyGraceSeconds,
} = await import("../../src/ui/preferences.js");

const nodes = {
  root: { id: "root", parent_id: null },
  a: { id: "a", parent_id: "root" },
  a1: { id: "a1", parent_id: "a" },
  a2: { id: "a2", parent_id: "a" },
  b: { id: "b", parent_id: "root" },
  docked: {
    id: "docked",
    parent_id: "root",
    origin: { kind: "note" },
    view: { docked: true },
  },
  ephemeral: { id: "ephemeral", parent_id: "root", _ephemeral: true },
};
const childrenOf = (id) => Object.values(nodes).filter((node) => node.parent_id === id);

assert.deepEqual(
  computeRibs("a1", nodes, childrenOf),
  ["b", "a2"],
  "ribs are the non-spine children of every spine card, ordered from root to tip",
);
assert.deepEqual(
  computeRibs("root", nodes, childrenOf),
  ["a", "b"],
  "docked notes and ephemeral nodes never become ribs",
);
assert.deepEqual(
  computeRibs("root", { root: nodes.root }, () => []),
  [],
  "a root-only tree has no ribs",
);

const retimed = retimeRibs(["kept", "new"], new Map([["kept", 10], ["stale", 20]]), 99);
assert.deepEqual(
  Array.from(retimed.entries()),
  [["kept", 10], ["new", 99]],
  "surviving ribs keep their clock, new ribs start now, and stale ribs disappear",
);

assert.equal(nodeNeedsReading({ status: "answered", origin: { kind: "ask" }, extensions: {} }), true);
assert.equal(nodeNeedsReading({ status: "pending", origin: { kind: "ask" }, extensions: {} }), false);
assert.equal(nodeNeedsReading({ status: "answered", origin: { kind: "note" }, extensions: {} }), false);
assert.equal(
  nodeNeedsReading({ status: "answered", origin: { kind: "ask" }, extensions: { attention: { seen_at: 42 } } }),
  false,
);

const splitAttention = makeNode({
  id: "split",
  extensions: {
    attention: { seen_at: 11 },
    canvas: { pin: { x: 1 } },
    learn: { block: { state: "done" } },
  },
});
assert.deepEqual(splitAttention.extensions, { attention: { seen_at: 11 } }, "attention stays in residual extensions");
assert.deepEqual(splitAttention.view, { pin: { x: 1 } });
assert.deepEqual(splitAttention.progress, { block: { state: "done" } });

let attentionState = createHoleState({
  hole_id: "attention-cycle",
  root_id: "root",
  nodes: [{
    id: "root",
    status: "answered",
    origin: { kind: "ask" },
    extensions: { attention: { seen_at: 10 }, retained: { value: true } },
  }],
});
attentionState = reduceHoleEvent(attentionState, {
  type: "node_answered",
  node_id: "root",
  title: "Fresh answer",
  markdown: "Fresh content",
}).state;
assert.deepEqual(attentionState.nodes.get("root").extensions, { retained: { value: true } }, "a fresh answer invalidates only attention");
attentionState = reduceHoleEvent(attentionState, {
  type: "node_extensions_patch",
  node_id: "root",
  namespace: "attention",
  value: { seen_at: 99 },
}).state;
assert.deepEqual(attentionState.nodes.get("root").extensions.attention, { seen_at: 99 });
const attentionRoundTrip = createHoleState(holeStateToHole(attentionState));
assert.deepEqual(
  attentionRoundTrip.nodes.get("root").extensions.attention,
  { seen_at: 99 },
  "attention patches round-trip through persisted node projection",
);

const policyNodes = {
  rib: { id: "rib", parent_id: "root", status: "answered", origin: { kind: "ask" }, extensions: { attention: { seen_at: 1 } } },
  child: { id: "child", parent_id: "rib", status: "answered", origin: { kind: "ask" }, extensions: { attention: { seen_at: 1 } } },
  ignoredNote: { id: "ignoredNote", parent_id: "rib", status: "pending", origin: { kind: "note" }, view: { docked: true } },
  ignoredDraft: { id: "ignoredDraft", parent_id: "rib", status: "pending", origin: { kind: "note" }, _ephemeral: true },
};
const policyChildren = (id) => Object.values(policyNodes).filter((node) => node.parent_id === id);
const baseFacts = {
  graceMs: 5000,
  hoveredCardId: null,
  nodePinned: () => false,
  nodeHasDraft: () => false,
};
const dueClock = new Map([["rib", 1000]]);
assert.deepEqual(
  decideAutoTidyFolds(["rib"], dueClock, policyNodes, policyChildren, 6000, baseFacts),
  [{ id: "rib", reason: "grace_elapsed" }],
  "a fully read, cold rib is selected with a machine-readable reason",
);
assert.match(
  decideAutoTidyFolds(["rib"], dueClock, policyNodes, policyChildren, 6000, baseFacts)[0].reason,
  /^[a-z][a-z0-9_]*$/,
);

const exemptionCases = [
  { label: "grace has not elapsed", clock: new Map([["rib", 1001]]), change: {} },
  { label: "rib is already collapsed", clock: dueClock, change: { rib: { collapsed: true } } },
  { label: "unread node is in subtree", clock: dueClock, change: { child: { extensions: {} } } },
  { label: "pinned node is in subtree", clock: dueClock, change: { facts: { nodePinned: (node) => node.id === "child" } } },
  { label: "pending node is in subtree", clock: dueClock, change: { child: { status: "pending" } } },
  { label: "draft is in subtree", clock: dueClock, change: { facts: { nodeHasDraft: (node) => node.id === "child" } } },
  { label: "hovered node is in subtree", clock: dueClock, change: { facts: { hoveredCardId: "child" } } },
];
for (const { label, clock, change } of exemptionCases) {
  const changedNodes = Object.fromEntries(
    Object.entries(policyNodes).map(([id, node]) => [id, { ...node, ...(change[id] || {}) }]),
  );
  const changedChildren = (id) => Object.values(changedNodes).filter((node) => node.parent_id === id);
  assert.deepEqual(
    decideAutoTidyFolds(
      ["rib"],
      clock,
      changedNodes,
      changedChildren,
      6000,
      { ...baseFacts, ...(change.facts || {}) },
    ),
    [],
    label,
  );
}

assert.equal(autoTidyEnabled(), false, "auto-tidy is opt-in");
assert.equal(autoTidyGraceSeconds(), AUTO_TIDY_GRACE_DEFAULT, "the default grace is two minutes");
assert.equal(clampAutoTidyGraceSeconds(1), 5, "stored grace clamps at five seconds");
assert.equal(clampAutoTidyGraceSeconds(901), 900, "stored grace clamps at fifteen minutes");

const notifications = [];
const stopListening = onPreferenceChange((kind) => notifications.push(kind));
assert.equal(setAutoTidyEnabled(true), true);
assert.equal(store.get("rh-auto-tidy"), "on");
assert.equal(setAutoTidyGraceSeconds(47), 47, "off-ladder values are never snapped in storage");
assert.equal(store.get("rh-auto-tidy-grace"), "47");
assert.equal(setAutoTidyGraceSeconds(1), 5);
assert.equal(setAutoTidyGraceSeconds(901), 900);
assert.equal(setAutoTidyGraceSeconds(AUTO_TIDY_GRACE_DEFAULT), AUTO_TIDY_GRACE_DEFAULT);
assert.equal(setAutoTidyEnabled(false), false);
assert.equal(store.has("rh-auto-tidy"), false, "off is represented by an absent key");
assert(notifications.length >= 6 && notifications.every((kind) => kind === "auto-tidy"));
stopListening();

assert.equal(formatAutoTidyGrace(30), "30 s");
assert.equal(formatAutoTidyGrace(120), "2 min");

console.log("auto-tidy unit contracts ok");
