import { CHANNEL_LANE } from "./branch-layout.js";

/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ id: string, start: Point, end: Point }} OrderedEdge */

/**
 * Ordered ports and disjoint subtree intervals make routing local: upward
 * bends use increasing lanes, downward bends decreasing lanes. Coincident
 * real source ports diverge in a small monotone fan before those bend lanes.
 * @param {OrderedEdge[]} edges
 * @param {{ left: number, right: number }} channel
 * @returns {Map<string, string>}
 */
export function routeOrderedEdges(edges, { left, right }) {
  const paths = new Map();
  const fanYs = edges.map((edge) => edge.start.y + (edge.end.y - edge.start.y) * 0.02);
  let separation = Infinity;
  for (let i = 1; i < edges.length; i++) {
    const edge = edges[i], previous = edges[i - 1];
    if (!edge || !previous || edge.start.y < previous.start.y || edge.end.y < previous.end.y) return paths;
    separation = Math.min(separation, (fanYs[i] || 0) - (fanYs[i - 1] || 0), edge.end.y - previous.end.y);
  }
  const radius = Math.min(3, separation / 4);
  let up = 0, down = 0;
  edges.forEach((edge, index) => {
    const fanY = fanYs[index] ?? edge.start.y;
    const lane = edge.end.y < fanY
      ? left + CHANNEL_LANE * (++up - 0.5)
      : right - CHANNEL_LANE * (++down - 0.5);
    const reach = Math.max(0, left - edge.start.x) / 2;
    let d = `M ${edge.start.x} ${edge.start.y} C ${edge.start.x + reach} ${edge.start.y} ${left - reach} ${fanY} ${left} ${fanY}`;
    d += roundedTurns([
      { x: left, y: fanY }, { x: lane, y: fanY }, { x: lane, y: edge.end.y }, edge.end,
    ], radius);
    paths.set(edge.id, d);
  });
  return paths;
}

/** @param {Point[]} points @param {number} radius */
function roundedTurns(points, radius) {
  let d = "";
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1], corner = points[i], next = points[i + 1];
    if (!previous || !corner || !next) continue;
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const after = Math.hypot(next.x - corner.x, next.y - corner.y);
    if (!before || !after) continue;
    const cut = Math.min(radius, before / 2, after / 2);
    const x1 = corner.x + (previous.x - corner.x) * cut / before;
    const y1 = corner.y + (previous.y - corner.y) * cut / before;
    const x2 = corner.x + (next.x - corner.x) * cut / after;
    const y2 = corner.y + (next.y - corner.y) * cut / after;
    d += ` L ${x1} ${y1} Q ${corner.x} ${corner.y} ${x2} ${y2}`;
  }
  const end = points[points.length - 1];
  if (end) d += ` L ${end.x} ${end.y}`;
  return d;
}
