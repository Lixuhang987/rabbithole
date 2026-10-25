import assert from "node:assert/strict";

export async function readCanvasGeometry(page) {
  // Layout and edge drawing each use a frame; sample after both queues have
  // drained so geometry assertions never observe a mixed frame.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.evaluate(() => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(document.getElementById("world")).transform);
    const cards = [...document.querySelectorAll("#world > .card, #world > [data-pinned-origin-id]")]
      .filter((card) => card.offsetHeight && !card.classList.contains("note-draft"))
      .map((card) => ({
        id: card.dataset.id || card.dataset.pinnedOriginId,
        x: parseFloat(card.style.left), y: parseFloat(card.style.top),
        w: card.offsetWidth, h: card.offsetHeight,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const edges = [...document.querySelectorAll("#edges path[data-child]")].map((path) => {
      const length = path.getTotalLength();
      const count = Math.max(2, Math.ceil(length / 3));
      return { id: path.dataset.child, d: path.getAttribute("d"), points: Array.from({ length: count + 1 }, (_, i) => {
        const point = path.getPointAtLength(length * i / count);
        return { x: point.x, y: point.y };
      }) };
    });
    return { cards, edges, view: { x: matrix.m41, y: matrix.m42, scale: matrix.a } };
  });
}

export function assertClearCanvas(geometry, nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (let i = 0; i < geometry.cards.length; i++) {
    const a = geometry.cards[i];
    for (const b of geometry.cards.slice(i + 1)) {
      assert(!(a.x < b.x + b.w - 0.1 && a.x + a.w > b.x + 0.1 && a.y < b.y + b.h - 0.1 && a.y + a.h > b.y + 0.1),
        `organized cards overlap: ${a.id} and ${b.id}`);
    }
  }
  for (const edge of geometry.edges) {
    const parentId = byId.get(edge.id)?.parent_id;
    for (const card of geometry.cards) {
      if (card.id === parentId || card.id === edge.id) continue;
      assert(!edge.points.some((p) => p.x > card.x + 0.5 && p.x < card.x + card.w - 0.5
        && p.y > card.y + 0.5 && p.y < card.y + card.h - 0.5),
      `connector ${edge.id} passes through unrelated card ${card.id}`);
    }
  }
  for (let i = 0; i < geometry.edges.length; i++) {
    const a = geometry.edges[i];
    for (const b of geometry.edges.slice(i + 1)) {
      for (let ai = 1; ai < a.points.length; ai++) {
        for (let bi = 1; bi < b.points.length; bi++) {
          assert(!properIntersection(a.points[ai - 1], a.points[ai], b.points[bi - 1], b.points[bi]),
            `connectors cross: ${a.id} and ${b.id}`);
        }
      }
    }
  }
}

function properIntersection(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return cross(a, b, c) * cross(a, b, d) < -1e-8 && cross(c, d, a) * cross(c, d, b) < -1e-8;
}
