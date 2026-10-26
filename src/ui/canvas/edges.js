import { childrenOf, currentNodeId, edgesSvg, isVisible, mode, nodes, readerMain, SVGNS } from "../core.js";
import { transitionMarkGroups } from "../text-marks.js";
import { effH } from "./card-measure.js";
import { r } from "./runtime.js";
import { canvasBody } from "./shared.js";
export function requestEdgeFrame() {
  if (r.edgeRaf) return;
  r.edgeRaf = requestAnimationFrame(function () {
    r.edgeRaf = 0;
    const redrawAll = r.edgeRedrawAll;
    const ids = r.edgeRedrawIds;
    const positionNodeIds = r.edgePositionNodeIds;
    r.edgeRedrawAll = false;
    r.edgeRedrawIds = {};
    r.edgePositionNodeIds = {};
    if (redrawAll) drawEdges();
    else drawEdgeSubset(ids, positionNodeIds);
  });
}

export function scheduleEdges() {
  r.edgeRedrawAll = true;
  r.edgeRedrawIds = {};
  r.edgePositionNodeIds = {};
  requestEdgeFrame();
}

export function scheduleNodeEdges(node) {
  if (!node || r.edgeRedrawAll) return requestEdgeFrame();
  r.edgePositionNodeIds[node.id] = true;
  if (node.parent_id) r.edgeRedrawIds[node.id] = true;
  const kids = childrenOf(node.id);
  for (let i = 0; i < kids.length; i++) r.edgeRedrawIds[kids[i].id] = true;
  requestEdgeFrame();
}

export { effH };

function edgeHeight(node, cache) {
  return (cache[node.id] ??= effH(node));
}

function isEdgeHighlighted(childId) {
  const child = nodes[childId];
  function cardHovered(id) {
    // Quotation hover takes precedence over the containing card's fan-out.
    return r.edgeCardHover[id] && !childrenOf(id).some((node) => r.edgeHl[node.id]);
  }
  return !!(r.edgeHl[childId] || cardHovered(childId) || (child?.parent_id && cardHovered(child.parent_id)));
}

function updatePortHighlight(port) {
  port.el.classList.toggle("edge-hl", [...port.children].some(isEdgeHighlighted));
}

function refreshEdgeHighlights() {
  for (const childId in r.edgeEls) r.edgeEls[childId].classList.toggle("edge-hl", isEdgeHighlighted(childId));
  for (const key in r.edgePorts) updatePortHighlight(r.edgePorts[key]);
}

function detachPort(childId) {
  const key = r.edgeGeometry[childId]?.portKey;
  const port = r.edgePorts[key];
  if (!port) return;
  port.children.delete(childId);
  if (!port.children.size) {
    port.el.remove();
    delete r.edgePorts[key];
  } else updatePortHighlight(port);
}

function removeEdge(childId) {
  detachPort(childId);
  r.edgeEls[childId]?.remove();
  delete r.edgeEls[childId];
  delete r.edgeGeometry[childId];
  delete r.edgeHl[childId];
}

export function rebuildEdges() {
  while (edgesSvg.firstChild) edgesSvg.removeChild(edgesSvg.firstChild);
  r.edgeEls = {};
  r.edgeGeometry = {};
  r.edgePorts = {};
  drawEdges();
}

export function drawEdges() {
  const live = {};
  const visCache = Object.create(null);
  const measureCache = Object.create(null);
  function vis(node) {
    return isVisible(node, visCache);
  }
  for (const id in nodes) {
    const n = nodes[id];
    if (!n.parent_id || !n.el) continue;
    const p = nodes[n.parent_id];
    if (!p || !p.el) continue;
    if (!vis(n) || !vis(p)) continue;
    live[n.id] = true;
    renderEdge(p, n, measureCache);
  }
  for (const childId in r.edgeEls) {
    if (!live[childId]) removeEdge(childId);
  }
  // Whatever moved the edges moved the marks: the margin dots ride along.
  r.lifecycle.hooks.positionDockedNotes();
}

export function drawEdgeSubset(ids, positionNodeIds) {
  const visCache = Object.create(null);
  const measureCache = Object.create(null);
  function vis(node) {
    return isVisible(node, visCache);
  }
  for (const childId in ids) {
    const child = nodes[childId];
    const parent = child && child.parent_id ? nodes[child.parent_id] : null;
    if (!child || !child.el || !parent || !parent.el || !vis(child) || !vis(parent)) {
      removeEdge(childId);
      continue;
    }
    renderEdge(parent, child, measureCache);
  }
  for (const nodeId in positionNodeIds) {
    const node = nodes[nodeId];
    if (node && node.bodyEl) r.lifecycle.hooks.positionDockedNotes(node.bodyEl);
    if (node && mode === "reader" && currentNodeId === node.id) r.lifecycle.hooks.positionDockedNotes(readerMain);
  }
}

function renderEdge(parent, child, measureCache) {
  const ph = edgeHeight(parent, measureCache),
    nh = edgeHeight(child, measureCache);
  const right = child.position.x + child.size.w / 2 >= parent.position.x + parent.size.w / 2;
  const side = right ? "right" : "left";
  const start = { x: parent.position.x + (right ? parent.size.w : 0), y: parent.position.y + ph / 2 };
  const end = { x: child.position.x + (right ? 0 : child.size.w), y: child.position.y + nh / 2 };
  const reach = Math.max(40, Math.abs(end.x - start.x) / 2) * (right ? 1 : -1);
  const d = `M ${start.x} ${start.y} C ${start.x + reach} ${start.y} ${end.x - reach} ${end.y} ${end.x} ${end.y}`;
  const portKey = parent.id + ":" + side;
  const prev = r.edgeGeometry[child.id];
  if (prev && prev.portKey !== portKey) detachPort(child.id);
  let path = r.edgeEls[child.id];
  if (!path) {
    path = document.createElementNS(SVGNS, "path");
    path.setAttribute("data-child", child.id);
    edgesSvg.appendChild(path);
    r.edgeEls[child.id] = path;
  }
  if (!prev || prev.d !== d) path.setAttribute("d", d);
  path.classList.toggle("edge-hl", isEdgeHighlighted(child.id));
  let port = r.edgePorts[portKey];
  if (!port) {
    const dot = document.createElementNS(SVGNS, "circle");
    dot.setAttribute("r", "3");
    dot.setAttribute("data-parent", parent.id);
    dot.setAttribute("data-side", side);
    edgesSvg.appendChild(dot);
    port = r.edgePorts[portKey] = { el: dot, children: new Set() };
  }
  port.children.add(child.id);
  port.el.setAttribute("cx", String(start.x));
  port.el.setAttribute("cy", String(start.y));
  updatePortHighlight(port);
  r.edgeGeometry[child.id] = { d, portKey };
}

export function setEdgeHighlight(childId, on) {
  if (on) r.edgeHl[childId] = true;
  else delete r.edgeHl[childId];
  refreshEdgeHighlights();
}

export function clearEdgeHighlight(childId) {
  delete r.edgeHl[childId];
  delete r.edgeCardHover[childId];
  refreshEdgeHighlights();
}

export function focusOrigin(node, on) {
  if (mode !== "canvas" && on) return;
  if (on) r.edgeCardHover[node.id] = true;
  else delete r.edgeCardHover[node.id];
  refreshEdgeHighlights();
  const p = node.parent_id ? nodes[node.parent_id] : null;
  const graphBody = canvasBody(p);
  if (graphBody) {
    const marks = graphBody.querySelectorAll('[data-child="' + node.id + '"]');
    for (let i = 0; i < marks.length; i++) marks[i].classList.toggle("mark-focus", on);
  }
}

export function onWorldMouseOver(e) {
  transitionMarkGroups(e, true, "mark-hover", setEdgeHighlight);
}

export function onWorldMouseOut(e) {
  transitionMarkGroups(e, false, "mark-hover", setEdgeHighlight);
}
