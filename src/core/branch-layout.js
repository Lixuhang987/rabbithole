import { TREE_PARENT_GAP, TREE_STACK_GAP, unionBounds } from "./layout.js";

export const CHANNEL_PADDING = 18;
export const CHANNEL_LANE = 12;

/** @typedef {{ id: string, parent_id: string | null, width: number, height: number }} BranchEntry */
/** @typedef {BranchEntry & { children: Branch[], span: number, depth: number }} Branch */
/** @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds */

/**
 * Entries are in sibling/source order. Every subtree owns a continuous vertical
 * interval, including when its internal cards are taller than its leaves.
 * @param {BranchEntry[]} entries
 */
export function layoutBranches(entries) {
  /** @type {Map<string, Branch>} */
  const branches = new Map(entries.map((entry) => [entry.id, { ...entry, children: [], span: 0, depth: 0 }]));
  /** @type {Branch[]} */
  const roots = [];
  for (const branch of branches.values()) {
    const parent = branch.parent_id ? branches.get(branch.parent_id) : null;
    if (parent) parent.children.push(branch);
    else roots.push(branch);
  }
  /** @type {number[]} */
  const widths = [];
  /** @type {number[]} */
  const lanes = [];
  /** @param {Branch} branch @param {number} depth */
  function measure(branch, depth) {
    branch.depth = depth;
    widths[depth] = Math.max(widths[depth] || 0, branch.width);
    lanes[depth] = Math.max(lanes[depth] || 0, branch.children.length);
    const childrenHeight = branch.children.reduce((sum, child) => sum + measure(child, depth + 1), 0)
      + Math.max(0, branch.children.length - 1) * TREE_STACK_GAP;
    branch.span = Math.max(branch.height, childrenHeight);
    return branch.span;
  }
  roots.forEach((root) => measure(root, 0));
  let columnX = 0;
  const columns = widths.map((width, depth) => {
    const gap = Math.max(TREE_PARENT_GAP, CHANNEL_PADDING * 2 + (lanes[depth] || 0) * CHANNEL_LANE);
    const column = { x: columnX, width, gap };
    columnX += width + gap;
    return column;
  });
  /** @type {Map<string, { x: number, y: number }>} */
  const positions = new Map();
  /** @param {Branch} branch @param {number} top @param {string[]} ids @returns {Bounds} */
  function place(branch, top, ids) {
    const x = columns[branch.depth]?.x || 0;
    const y = top + (branch.span - branch.height) / 2;
    positions.set(branch.id, { x, y });
    ids.push(branch.id);
    let bounds = { minX: x, minY: top, maxX: x + branch.width, maxY: top + branch.span };
    const childrenHeight = branch.children.reduce((sum, child) => sum + child.span, 0)
      + Math.max(0, branch.children.length - 1) * TREE_STACK_GAP;
    let childTop = top + (branch.span - childrenHeight) / 2;
    for (const child of branch.children) {
      bounds = unionBounds(bounds, place(child, childTop, ids));
      childTop += child.span + TREE_STACK_GAP;
    }
    return bounds;
  }
  let top = 0;
  const trees = roots.map((root) => {
    /** @type {string[]} */
    const ids = [];
    const bounds = place(root, top, ids);
    top += root.span + TREE_PARENT_GAP;
    return { rootId: root.id, ids, bounds };
  });
  return { positions, columns, trees };
}
