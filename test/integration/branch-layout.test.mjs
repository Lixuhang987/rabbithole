/** @protects independently centered depth columns, direct-child cluster spacing, and folding. */
import assert from "node:assert/strict";
import { layoutBranches } from "../../src/core/branch-layout.js";
import { TREE_PARENT_GAP, TREE_STACK_GAP } from "../../src/core/layout.js";

const entries = [
  { id: "root", parent_id: null, width: 200, height: 120 },
  { id: "a", parent_id: "root", width: 150, height: 360 },
  { id: "b", parent_id: "root", width: 240, height: 80 },
  { id: "a1", parent_id: "a", width: 100, height: 36 },
  { id: "a2", parent_id: "a", width: 100, height: 36 },
  { id: "b1", parent_id: "b", width: 100, height: 460 },
  { id: "note", parent_id: null, width: 300, height: 180 },
];
const original = structuredClone(entries);
const result = layoutBranches(entries);
const at = (id) => result.positions.get(id);
const entry = (id) => entries.find((item) => item.id === id);
const center = (id) => at(id).y + entry(id).height / 2;
const rect = (id, positions = result.positions) => {
  const position = positions.get(id);
  const item = entry(id);
  return { minX: position.x, minY: position.y, maxX: position.x + item.width, maxY: position.y + item.height };
};

assert.deepEqual(entries, original, "layout must not rewrite the document graph");
assert.equal(at("a").x, at("b").x, "direct children share the first branch column");
assert.equal(at("a1").x, at("a2").x, "grandchildren share the second branch column");
assert.equal(at("a1").x, at("b1").x, "all nodes at a depth share one column");
assert(at("a").y + entry("a").height + TREE_STACK_GAP <= at("b").y, "direct siblings are packed with one stack gap");
assert(at("a1").y + entry("a1").height + TREE_STACK_GAP <= at("a2").y, "same-parent children are contiguous");
assert.equal(at("a2").y + entry("a2").height + 90, at("b1").y,
  "different-parent child clusters have a larger gap than siblings");
assert.equal(at("a1").y + entry("a1").height + 30, at("a2").y,
  "same-parent children retain the compact sibling gap");
assert.equal(at("a").x, entry("note").width + TREE_PARENT_GAP, "first column uses a fixed gap after the widest root");
assert.equal(at("a1").x, at("a").x + entry("b").width + TREE_PARENT_GAP,
  "next column uses a fixed gap after its widest parent");
assert.equal(center("root"), (at("a1").y + at("b1").y + entry("b1").height) / 2,
  "each whole depth column remains independently centered");
const directChildBlockCenter = at("a").y + (entry("a").height + TREE_STACK_GAP + entry("b").height) / 2;
assert.equal(center("root"), directChildBlockCenter, "the root centers over its direct-child column");
assert.equal(result.trees.length, 2);
assert(result.trees[1].bounds.minY >= result.trees[0].bounds.maxY + TREE_STACK_GAP, "independent roots occupy disjoint vertical blocks");
assert(at("a").x >= entry("note").width + TREE_STACK_GAP, "depth columns account for the widest root");

const ids = entries.map((item) => item.id);
for (let i = 0; i < ids.length; i++) {
  for (let j = i + 1; j < ids.length; j++) {
    const a = rect(ids[i]), b = rect(ids[j]);
    assert(!(a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY), `${ids[i]} and ${ids[j]} must not overlap`);
  }
}

const deep = structuredClone(entries);
const deepResult = layoutBranches(deep);
for (const item of deep) if (item.id === "b1") item.height = 1000;
const stretched = layoutBranches(deep);
assert.equal(
  stretched.positions.get("a").y - stretched.positions.get("b").y,
  deepResult.positions.get("a").y - deepResult.positions.get("b").y,
  "a deep descendant must not spread its shallower sibling column",
);
assert.equal(
  stretched.positions.get("a1").y - stretched.positions.get("a2").y,
  deepResult.positions.get("a1").y - deepResult.positions.get("a2").y,
  "deep descendants must not change a shallower child group",
);

entries.filter((item) => item.parent_id).forEach((item) => { item.height = 36; });
const folded = layoutBranches(entries);
assert(folded.trees[0].bounds.maxY < result.trees[0].bounds.maxY, "folding shrinks the same tree without hiding descendants");
assert.equal(folded.positions.size, entries.length);
assert.equal(folded.positions.get("a").x, folded.positions.get("b").x);
console.log("ok branch layout: BFS columns, grouped siblings, centered columns, independent roots, cluster gaps, and folding");
