import { cloneJson } from "../schema.js";
import { askOfNode } from "./ask.js";
import { normalizeBookmark } from "./bookmark.js";
import { makeNode, projectNode } from "./node.js";

/** @typedef {import("../contracts/engine.js").HoleState} HoleState */
/** @typedef {import("../contracts/engine.js").HoleNode} HoleNode */

/** @param {Parameters<import("../contracts/engine.js").createHoleState>[0]} [input] @param {{ cloneExtensions?: boolean, canonicalNodes?: boolean }} [options] @returns {HoleState} */
export function createHoleState({ hole_id, title, root_id, created_at = null, view_state = null, nodes = [] } = {}, { cloneExtensions = true, canonicalNodes = false } = {}) {
  const entries = /** @type {Iterable<[string, HoleNode]>} */ (nodes instanceof Map
    ? nodes
    : (nodes || []).map((node) => [node.id, node]));
  const stateNodes = new Map();
  for (const [id, node] of entries) {
    const cloned = {
      ...node,
      ...(Object.prototype.hasOwnProperty.call(node, "extensions")
        ? { extensions: cloneExtensions ? cloneJson(node.extensions) : node.extensions }
        : {}),
    };
    stateNodes.set(id, canonicalNodes ? makeNode(cloned) : cloned);
  }
  const asks = new Map();
  for (const node of stateNodes.values()) {
    const ask = askOfNode(node);
    if (ask) asks.set(ask.id, ask);
  }
  return {
    hole_id: hole_id || "",
    title: title || "Untitled",
    root_id: root_id || null,
    created_at,
    view_state,
    bookmark: normalizeBookmark(view_state),
    nodes: stateNodes,
    asks,
    progressRuns: new Map(),
  };
}

/** @param {HoleState} state */
export function holeStateToHole(state) {
  return {
    hole_id: state.hole_id,
    title: state.title,
    root_id: state.root_id,
    created_at: state.created_at,
    view_state: state.view_state,
    nodes: [...state.nodes.values()].map((node) => (
      Object.prototype.hasOwnProperty.call(node, "view")
        || Object.prototype.hasOwnProperty.call(node, "progress")
        ? projectNode(node, "persist")
        : node
    )),
  };
}

/**
 * Canonical node projection for the live/frozen browser hydration wire.
 * @param {HoleState} state
 * @param {{ suppressRootOrigin?: boolean, cloneExtensions?: boolean }} [options]
 */
export function holeStateToHydrationNodes(state, { suppressRootOrigin = false, cloneExtensions = true } = {}) {
  const result = new Array(state.nodes.size);
  let index = 0;
  for (const node of state.nodes.values()) {
    const projected = projectNode(node, "hydrate");
    if (suppressRootOrigin && node.id === state.root_id) projected.origin = null;
    if (!cloneExtensions && !Object.prototype.hasOwnProperty.call(node, "view") && !Object.prototype.hasOwnProperty.call(node, "progress")) {
      projected.extensions = node.extensions ?? {};
    }
    result[index++] = projected;
  }
  return result;
}
