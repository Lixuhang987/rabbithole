import { isDockedNote } from "../../core/hole/ask.js";
import { nodeOrder } from "../../core/layout.js";
import { childrenOf, isVisible, nodes, rootId } from "../core.js";
import { syncCardTitle } from "./card-title.js";
import { drawEdges, effH } from "./edges.js";
import { layoutNode } from "./gestures.js";
import { placedChildren, syncCollapseButton } from "./menu.js";
import { r } from "./runtime.js";
import { canvasCard, persistCanvasExtension, syncNodePinPresentation } from "./shared.js";

export function applyCollapsedState(node, collapsed) {
  if (node.collapsed === collapsed) return false;
  node.collapsed = collapsed;
  syncCardTitle(node);
  if (node.el) node.el.classList.toggle("collapsed", collapsed);
  if (node.collapseBtn) syncCollapseButton(node, node.collapseBtn);
  if (!collapsed && node.el) layoutNode(node);
  else if (node.el) syncNodePinPresentation(node);
  return true;
}

export function windowBranch(node) {
  const branch = [];
  function collect(current) {
    if (!isDockedNote(current)) branch.push(current);
    childrenOf(current.id).slice().sort(nodeOrder).forEach(collect);
  }
  collect(node);
  return branch;
}

export function branchAllCollapsed(node) {
  const branch = windowBranch(node);
  return (
    branch.length > 0 &&
    branch.every(function (current) {
      return !!current.collapsed;
    })
  );
}

export function collapseStackPositions(node) {
  const stack = node && node.view && node.view.collapse_stack;
  if (
    !stack ||
    stack.version !== 1 ||
    !stack.positions ||
    typeof stack.positions !== "object" ||
    Array.isArray(stack.positions)
  )
    return null;
  return stack.positions;
}

export function setCollapseStackPositions(node, positions) {
  node.view = Object.assign({}, node.view, {
    collapse_stack: { version: 1, positions: positions },
  });
  persistCanvasExtension(node);
}

export function clearCollapseStack(node) {
  if (!collapseStackPositions(node)) return false;
  node.view = Object.assign({}, node.view);
  delete node.view.collapse_stack;
  persistCanvasExtension(node);
  return true;
}

export function collapseStackOwnersFor(targets) {
  const ids = new Set(
    targets.map(function (current) {
      return current.id;
    }),
  );
  return Object.keys(nodes)
    .map(function (id) {
      return nodes[id];
    })
    .filter(function (candidate) {
      const positions = collapseStackPositions(candidate);
      return (
        positions &&
        Object.keys(positions).some(function (id) {
          return ids.has(id);
        })
      );
    });
}

export function restoreCollapseStacksFor(targets, persist) {
  const owners = collapseStackOwnersFor(targets);
  const restored = [];
  owners.forEach(function (owner) {
    const positions = collapseStackPositions(owner);
    Object.keys(positions).forEach(function (id) {
      const current = nodes[id],
        position = positions[id];
      if (!current || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
      current.position.x = position.x;
      current.position.y = position.y;
      layoutNode(current);
      restored.push(current);
    });
    clearCollapseStack(owner);
  });
  if (persist !== false && restored.length) r.lifecycle.hooks.persistNodesBulk(Array.from(new Set(restored)));
  return restored;
}

export function translateStoredStackPositions(origins) {
  const deltas = Object.create(null);
  origins.forEach(function (origin) {
    deltas[origin.node.id] = { x: origin.node.position.x - origin.x, y: origin.node.position.y - origin.y };
  });
  Object.keys(nodes).forEach(function (id) {
    let owner = nodes[id],
      positions = collapseStackPositions(owner),
      changed = false;
    if (!positions) return;
    const next = Object.assign({}, positions);
    Object.keys(deltas).forEach(function (targetId) {
      const position = next[targetId],
        delta = deltas[targetId];
      if (!position || (!delta.x && !delta.y)) return;
      next[targetId] = { x: position.x + delta.x, y: position.y + delta.y };
      changed = true;
    });
    if (changed) setCollapseStackPositions(owner, next);
  });
}

export function discardAllCollapseStacks() {
  Object.keys(nodes).forEach(function (id) {
    clearCollapseStack(nodes[id]);
  });
}

export function compactCollapsedBranch(node, branch) {
  if (branch.length < 2) return;
  const positions = Object.create(null);
  branch.forEach(function (current) {
    positions[current.id] = { x: current.position.x, y: current.position.y };
  });
  setCollapseStackPositions(node, positions);
  let cursorY = node.position.y + effH(node) + r.COLLAPSED_STACK_GAP;
  function placeChildren(parent, depth) {
    placedChildren(parent.id)
      .slice()
      .sort(nodeOrder)
      .forEach(function (child) {
        child.position.x = node.position.x + Math.min(depth, r.COLLAPSED_STACK_MAX_DEPTH) * r.COLLAPSED_STACK_INDENT;
        child.position.y = cursorY;
        cursorY += effH(child) + r.COLLAPSED_STACK_GAP;
        placeChildren(child, depth + 1);
      });
  }
  placeChildren(node, 1);
}

export function toggleCollapse(node) {
  if (node._ephemeral) return;
  const organized = r.canvasMaintenance?.layoutEnabled();
  const restored = node.collapsed && !organized ? restoreCollapseStacksFor([node], false) : [];
  if (!applyCollapsedState(node, !node.collapsed)) return;
  if (!node.collapsed) r.canvasMaintenance?.branchExpanded(node.id);
  renderVisibility();
  drawEdges();
  if (restored.length) r.lifecycle.hooks.persistNodesBulk(Array.from(new Set(restored.concat(node))));
  else r.lifecycle.hooks.persistNode(node);
}

export function setBranchCollapsed(node, collapsed) {
  if (!node || node._ephemeral) return;
  const branch = windowBranch(node);
  const organized = r.canvasMaintenance?.layoutEnabled();
  if (!organized) restoreCollapseStacksFor(branch, false);
  const changed = branch.filter(function (current) {
    return applyCollapsedState(current, collapsed);
  });
  if (collapsed && !organized) compactCollapsedBranch(node, branch);
  branch.forEach(layoutNode);
  if (changed.length || collapsed) r.lifecycle.hooks.persistNodesBulk(branch);
  if (!collapsed) r.canvasMaintenance?.branchExpanded(node.id);
  renderVisibility();
  drawEdges();
}

// "Collapse children" means exactly that: every descendant folds and the card
// you asked from stays as it is. That is the whole difference from "Collapse
// branch", which is this same walk with the card itself included.
export function setChildrenCollapsed(node, collapsed) {
  if (!node || node._ephemeral) return;
  const descendants = [];
  function collect(current) {
    childrenOf(current.id).forEach(function (kid) {
      descendants.push(kid);
      collect(kid);
    });
  }
  collect(node);
  const restored =
    collapsed || r.canvasMaintenance?.layoutEnabled() ? [] : restoreCollapseStacksFor(descendants, false);
  const changed = descendants.filter(function (current) {
    return applyCollapsedState(current, collapsed);
  });
  const persisted = Array.from(new Set(restored.concat(changed)));
  if (persisted.length) r.lifecycle.hooks.persistNodesBulk(persisted);
  renderVisibility();
  drawEdges();
}

export function renderVisibility() {
  const cache = Object.create(null);
  for (const id in nodes) {
    const n = nodes[id];
    if (!n.el) continue;
    let display;
    if (n.id === rootId) {
      display = "";
      cache[n.id] = true;
    } else display = isVisible(n, cache) ? "" : "none";
    const graphCard = canvasCard(n);
    if (graphCard.style.display !== display) graphCard.style.display = display;
    if (!n.canvasEl && n.el.style.display !== display) n.el.style.display = display;
  }
}
