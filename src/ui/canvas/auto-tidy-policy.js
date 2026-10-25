import { isDockedNote } from "../../core/hole/ask.js";
import { nodeNeedsReading } from "../../core/hole/node.js";

function nodeAt(collection, id) {
  return collection instanceof Map ? collection.get(id) : collection && collection[id];
}

export function computeRibs(warmId, nodeCollection, childNodesOf) {
  const warm = nodeAt(nodeCollection, warmId);
  if (!warm) return [];
  const lineage = [];
  const spine = new Set();
  let current = warm;
  while (current && !spine.has(current.id)) {
    lineage.unshift(current.id);
    spine.add(current.id);
    current = current.parent_id == null ? null : nodeAt(nodeCollection, current.parent_id);
  }
  const ribs = [];
  lineage.forEach(function (id) {
    const children = childNodesOf(id) || [];
    children.forEach(function (entry) {
      const child = typeof entry === "string" ? nodeAt(nodeCollection, entry) : entry;
      if (!child || spine.has(child.id) || child._ephemeral || isDockedNote(child)) return;
      ribs.push(child.id);
    });
  });
  return ribs;
}

export function retimeRibs(ribIds, oldMap, now) {
  const next = new Map();
  ribIds.forEach(function (id) {
    next.set(id, oldMap.has(id) ? oldMap.get(id) : now);
  });
  return next;
}

export function decideAutoTidyFolds(ribIds, clocks, nodeCollection, childNodesOf, now, facts) {
  const graceMs = Number(facts?.graceMs) || 0;
  const hoveredCardId = facts?.hoveredCardId || null;
  const nodePinned =
    typeof facts?.nodePinned === "function"
      ? facts.nodePinned
      : function () {
          return false;
        };
  const nodeHasDraft =
    typeof facts?.nodeHasDraft === "function"
      ? facts.nodeHasDraft
      : function () {
          return false;
        };
  const decisions = [];
  ribIds.forEach(function (id) {
    const rib = nodeAt(nodeCollection, id);
    const stamp = clocks.get(id);
    if (!rib || rib.collapsed || !Number.isFinite(stamp) || now - stamp < graceMs) return;
    const pending = [rib];
    const seen = new Set();
    let exempt = false;
    while (pending.length && !exempt) {
      const node = pending.pop();
      if (!node || seen.has(node.id) || node._ephemeral || isDockedNote(node)) continue;
      seen.add(node.id);
      exempt = !!(
        nodeNeedsReading(node) ||
        nodePinned(node) ||
        node.status === "pending" ||
        nodeHasDraft(node) ||
        node.id === hoveredCardId
      );
      if (exempt) continue;
      (childNodesOf(node.id) || []).forEach(function (entry) {
        pending.push(typeof entry === "string" ? nodeAt(nodeCollection, entry) : entry);
      });
    }
    if (!exempt) decisions.push({ id: id, reason: "grace_elapsed" });
  });
  return decisions;
}
