/** @protects centered variable-size document branches and ordered connector channels. */
import assert from "node:assert/strict";
import { layoutBranches } from "../../src/core/branch-layout.js";
import { routeOrderedEdges } from "../../src/core/branch-routing.js";

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
const center = (id) => at(id).y + entries.find((entry) => entry.id === id).height / 2;
assert.deepEqual(entries, original, "layout must not rewrite the document graph");
assert.equal(center("root"), 425, "the root centers over the entire 850px reserved branch area");
assert.equal(center("a"), 180, "a large internal document reserves space beyond its small leaf cards");
assert.equal(center("b"), 620, "a tall descendant reserves space for its short parent");
assert.equal(center("b"), center("b1"), "a single child stays centered on its parent");
assert.equal(center("a1") + center("a2"), 2 * center("a"), "two equal leaves straddle their parent");
assert.equal(at("a").x, at("b").x, "every direct child uses the next depth column");
assert.equal(at("a1").x, at("b1").x, "grandchildren use one shared, separately sized column");
assert(at("a").x >= 300 + 70, "column width accounts for the widest root, including an independent note");
assert(at("note").y >= 850 + 70, "independent roots occupy disjoint vertical blocks");

const rootPorts = [
  { id: "a", start: { x: 200, y: at("root").y + 20 }, end: { x: at("a").x, y: center("a") } },
  { id: "b", start: { x: 200, y: at("root").y + 100 }, end: { x: at("b").x, y: center("b") } },
];
const routes = routeOrderedEdges(rootPorts, { left: 318, right: at("a").x - 18 });
assert.equal(routes.size, 2);
rootPorts.forEach((edge) => {
  const route = routes.get(edge.id);
  assert(route.startsWith(`M ${edge.start.x} ${edge.start.y}`), "routes preserve their real source ports");
  assert(route.endsWith(`L ${edge.end.x} ${edge.end.y}`), "routes terminate on their own child card");
  assert(!/NaN|Infinity/.test(route));
});

entries.filter((entry) => entry.parent_id).forEach((entry) => { entry.height = 36; });
const folded = layoutBranches(entries);
assert(folded.trees[0].bounds.maxY < result.trees[0].bounds.maxY, "folding shrinks the same tree without hiding descendants");
assert.equal(folded.positions.size, entries.length);
assert.equal(folded.positions.get("a").x, folded.positions.get("b").x);
console.log("ok branch layout: mixed card sizes, centered descendants, independent roots, channels, and folding");
