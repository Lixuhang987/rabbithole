import { isDockedNote } from "../../core/hole/ask.js";
import { nodeOrder } from "../../core/layout.js";
import { nodes, rootId } from "../core.js";
import { cardFootprint, sourceOrder } from "./card-measure.js";
import { canvasCard } from "./shared.js";

export function layoutCards() {
  return Object.values(nodes).filter(
    (node) => !node._ephemeral && !node._pendingDelete && !isDockedNote(node) && canvasCard(node),
  );
}

// Parent-first entries serve both automatic change detection and organization.
export function measureBranches() {
  const cards = layoutCards();
  const ids = new Set(cards.map((node) => node.id));
  const groups = new Map();
  cards.forEach((node) => {
    const parent = ids.has(node.parent_id) ? node.parent_id : null;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(node);
  });
  const entries = [];
  function visit(parentId) {
    const parent = nodes[parentId];
    const group = groups.get(parentId) || [];
    const order = new Map(group.map((node) => [node.id, parent ? sourceOrder(parent, node) : Infinity]));
    group.sort((a, b) => {
      if (!parent && (a.id === rootId || b.id === rootId)) return a.id === rootId ? -1 : 1;
      const anchor = order.get(a.id) - order.get(b.id) || 0;
      return anchor || nodeOrder(a, b);
    });
    group.forEach((node) => {
      entries.push({ id: node.id, parent_id: parentId, ...cardFootprint(node) });
      visit(node.id);
    });
  }
  visit(null);
  return entries;
}
