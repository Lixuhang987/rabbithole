import { layoutBranches } from "../../core/branch-layout.js";
import { boundsOverlap, shiftBounds, TREE_STACK_GAP } from "../../core/layout.js";
import { nodes, view } from "../core.js";
import { layoutCards, measureBranches } from "./branch-geometry.js";
import { applyTransform, cancelViewAnimation } from "./camera.js";
import { cardFootprint } from "./card-measure.js";
import { scheduleEdges } from "./edges.js";
import { clearCollapseStack, discardAllCollapseStacks } from "./fold.js";
import { layoutNode } from "./gestures.js";
import { r } from "./runtime.js";

export function organizeCanvas({ roots = null, anchorId = null } = {}) {
  // A full organization replaces every saved fold restore point. Scoped
  // organization retires only the stacks in the trees it actually replaces.
  if (!roots) discardAllCollapseStacks();
  const layout = layoutBranches(measureBranches());
  const anchor = nodes[anchorId];
  const before = anchor ? { ...anchor.position } : null;
  const moved = [];
  const cards = layoutCards();
  // A fold glide is a temporary screen-space correction. A settled layout
  // supersedes it; leaving the transform alive would make a freshly arranged
  // card intercept clicks at its old visual position.
  for (const node of cards) {
    const card = node.canvasEl || node.el;
    if (!card) continue;
    card.style.transition = "";
    card.style.transform = "";
  }
  for (const tree of layout.trees) {
    if (roots && !roots.has(tree.rootId)) continue;
    const root = nodes[tree.rootId];
    const rootPosition = layout.positions.get(tree.rootId);
    let dx = roots ? root.position.x - rootPosition.x : 0;
    let dy = roots ? root.position.y - rootPosition.y : 0;
    if (roots) {
      const members = new Set(tree.ids);
      const obstacles = cards
        .filter((node) => !members.has(node.id))
        .map((node) => {
          const size = cardFootprint(node);
          return {
            minX: node.position.x,
            minY: node.position.y,
            maxX: node.position.x + size.width,
            maxY: node.position.y + size.height,
          };
        })
        .sort((a, b) => a.minY - b.minY);
      let bounds = shiftBounds(tree.bounds, dx, dy);
      for (const obstacle of obstacles) {
        if (!boundsOverlap(bounds, obstacle)) continue;
        const shift = obstacle.maxY + TREE_STACK_GAP - bounds.minY;
        dy += shift;
        bounds = shiftBounds(bounds, 0, shift);
      }
    }
    for (const id of tree.ids) {
      const node = nodes[id];
      const position = layout.positions.get(id);
      const x = position.x + dx,
        y = position.y + dy;
      if (roots) clearCollapseStack(node);
      if (Math.abs(node.position.x - x) < 0.001 && Math.abs(node.position.y - y) < 0.001) continue;
      node.position.x = x;
      node.position.y = y;
      layoutNode(node);
      moved.push(node);
    }
  }
  if (before && anchor && (before.x !== anchor.position.x || before.y !== anchor.position.y)) {
    cancelViewAnimation();
    view.x += (before.x - anchor.position.x) * view.scale;
    view.y += (before.y - anchor.position.y) * view.scale;
    applyTransform();
  }
  if (moved.length) r.lifecycle.hooks.persistNodesBulk(moved);
  scheduleEdges();
  return moved;
}
