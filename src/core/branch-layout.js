import { TREE_PARENT_GAP, TREE_STACK_GAP, unionBounds } from "./layout.js";

export const CHANNEL_PADDING = 18;
export const CHANNEL_LANE = 12;

/** @typedef {{ id: string, parent_id: string | null, width: number, height: number }} BranchEntry */
/** @typedef {BranchEntry & { children: Branch[] }} Branch */
/** @typedef {{ minX: number, minY: number, maxX: number, maxY: number }} Bounds */

/**
 * Lay out every branch tree one depth column at a time.
 *
 * Siblings are collected with a breadth-first walk, so each column is one
 * contiguous block ordered by its parents and each parent owns a contiguous
 * range of children. Columns are then centered independently around the
 * direct-child block; descendant columns cannot expand an earlier column.
 * @param {BranchEntry[]} entries
 */
export function layoutBranches(entries) {
  /** @type {Map<string, Branch>} */
  const branches = new Map(entries.map((entry) => [entry.id, { ...entry, children: [] }]));
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
  /** @type {Map<string, Branch[][]>} */
  const treeColumns = new Map();
  for (const root of roots) {
    /** @type {Branch[][]} */
    const byDepth = [];
    /** @type {Branch[]} */
    const queue = [root];
    const depths = new Map([[root.id, 0]]);
    for (let index = 0; index < queue.length; index++) {
      const branch = queue[index];
      if (!branch) continue;
      const depth = depths.get(branch.id) || 0;
      (byDepth[depth] ||= []).push(branch);
      widths[depth] = Math.max(widths[depth] || 0, branch.width);
      lanes[depth] = Math.max(lanes[depth] || 0, branch.children.length);
      for (const child of branch.children) {
        depths.set(child.id, depth + 1);
        queue.push(child);
      }
    }
    treeColumns.set(root.id, byDepth);
  }

  let columnX = 0;
  const columns = widths.map((width, depth) => {
    const gap = Math.max(TREE_PARENT_GAP, CHANNEL_PADDING * 2 + (lanes[depth] || 0) * CHANNEL_LANE);
    const column = { x: columnX, width, gap };
    columnX += width + gap;
    return column;
  });

  /** @type {Map<string, { x: number, y: number }>} */
  const positions = new Map();
  /** @type {Map<string, Bounds>} */
  const treeBounds = new Map();
  let nextTreeTop = 0;

  for (const root of roots) {
    const byDepth = treeColumns.get(root.id) || [];
    const blockHeights = byDepth.map((column) =>
      column.reduce((sum, branch) => sum + branch.height, 0)
      + Math.max(0, column.length - 1) * TREE_STACK_GAP,
    );
    const centerY = blockHeights[1] != null
      ? blockHeights[1] / 2
      : (blockHeights[0] || 0) / 2;
    const localPositions = new Map();
    let localBounds = null;
    for (let depth = 0; depth < byDepth.length; depth++) {
      const column = byDepth[depth];
      const blockHeight = blockHeights[depth];
      if (!column || blockHeight == null) continue;
      let y = centerY - blockHeight / 2;
      for (const branch of column) {
        const position = { x: columns[depth]?.x || 0, y };
        localPositions.set(branch.id, position);
        const bounds = { minX: position.x, minY: y, maxX: position.x + branch.width, maxY: y + branch.height };
        localBounds = unionBounds(localBounds, bounds);
        y += branch.height + TREE_STACK_GAP;
      }
    }

    if (!localBounds) continue;
    const dy = nextTreeTop - localBounds.minY;
    for (const column of byDepth) {
      for (const branch of column) {
        const position = localPositions.get(branch.id);
        positions.set(branch.id, { x: position.x, y: position.y + dy });
      }
    }
    const bounds = { minX: localBounds.minX, minY: localBounds.minY + dy, maxX: localBounds.maxX, maxY: localBounds.maxY + dy };
    treeBounds.set(root.id, bounds);
    nextTreeTop = bounds.maxY + TREE_PARENT_GAP;
  }

  const trees = roots.map((root) => ({
    rootId: root.id,
    ids: (treeColumns.get(root.id) || []).flat().map((branch) => branch.id),
    bounds: treeBounds.get(root.id) || { minX: 0, minY: nextTreeTop, maxX: 0, maxY: nextTreeTop },
  }));
  return { positions, columns, trees };
}
