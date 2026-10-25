import { CHANNEL_LANE, CHANNEL_PADDING } from "../../core/branch-layout.js";
import { routeOrderedEdges } from "../../core/branch-routing.js";
import { childrenOf, nodes } from "../core.js";
import { layoutCards, treeRootId } from "./branch-geometry.js";
import { cardFootprint, effH } from "./card-measure.js";

// Derive organized routing from saved geometry, so reopen and frozen snapshots
// need no private layout flag. Freely dragged cards keep their ordinary edges.
export function organizedEdge(parent, child, cache, startOf, endOf) {
  if (!cache.organized) cache.organized = new Map();
  if (!cache.organized.has(parent.id)) {
    cache.organized.set(parent.id, routesForParent(parent, cache, startOf, endOf));
  }
  return cache.organized.get(parent.id).get(child.id);
}

function routesForParent(parent, cache, startOf, endOf) {
  const available = cache.layoutCards || (cache.layoutCards = new Map(layoutCards().map((node) => [node.id, node])));
  const children = childrenOf(parent.id)
    .filter((node) => available.has(node.id))
    .slice()
    .sort((a, b) => a.position.y - b.position.y);
  const result = new Map();
  if (!children.length) return result;
  const childX = children[0].position.x;
  if (children.some((node) => Math.abs(node.position.x - childX) > 0.01)) return result;
  if (!cache.columnRights) {
    cache.columnRights = new Map();
    for (const node of available.values()) {
      const key = treeRootId(node) + ":" + node.position.x;
      cache.columnRights.set(
        key,
        Math.max(cache.columnRights.get(key) || -Infinity, node.position.x + cardFootprint(node).width),
      );
    }
  }
  const key = treeRootId(parent) + ":" + parent.position.x;
  const left = (cache.columnRights.get(key) || parent.position.x + parent.size.w) + CHANNEL_PADDING;
  const right = childX - CHANNEL_PADDING;
  if (right - left < children.length * CHANNEL_LANE - 0.01) return result;
  const edges = children.map((node) => ({
    id: node.id,
    start: startOf(parent, node, "right", cache),
    end: endOf(node, "left", cache),
  }));
  fillUnanchoredPorts(edges, parent);
  const paths = routeOrderedEdges(edges, { left, right });
  edges.forEach((edge) => {
    if (paths.has(edge.id)) result.set(edge.id, { d: paths.get(edge.id), start: edge.start });
  });
  return result;
}

function fillUnanchoredPorts(edges, parent) {
  const height = effH(parent);
  const top = parent.position.y + Math.min(16, height / 2);
  const bottom = parent.position.y + height - Math.min(22, height / 2);
  for (let i = 0; i < edges.length; ) {
    if (edges[i].start.anchored) {
      i++;
      continue;
    }
    let end = i;
    while (end < edges.length && !edges[end].start.anchored) end++;
    const low = i ? edges[i - 1].start.y : parent.collapsed ? parent.position.y + height / 2 : top;
    const high = end < edges.length ? edges[end].start.y : parent.collapsed ? parent.position.y + height / 2 : bottom;
    for (let j = i; j < end; j++) edges[j].start.y = low + ((high - low) * (j - i + 1)) / (end - i + 1);
    i = end;
  }
}
