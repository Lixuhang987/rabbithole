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
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(path.getTotalLength());
      return { id: path.dataset.child, d: path.getAttribute("d"),
        start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y },
        highlighted: path.classList.contains("edge-hl") };
    });
    const ports = [...document.querySelectorAll("#edges circle")].map((dot) => ({
      parentId: dot.dataset.parent, side: dot.dataset.side,
      x: Number(dot.getAttribute("cx")), y: Number(dot.getAttribute("cy")),
      highlighted: dot.classList.contains("edge-hl"),
    }));
    return { cards, edges, ports, view: { x: matrix.m41, y: matrix.m42, scale: matrix.a } };
  });
}

export function assertCanvasConnections(geometry, nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (let i = 0; i < geometry.cards.length; i++) {
    const a = geometry.cards[i];
    for (const b of geometry.cards.slice(i + 1)) {
      assert(!(a.x < b.x + b.w - 0.1 && a.x + a.w > b.x + 0.1 && a.y < b.y + b.h - 0.1 && a.y + a.h > b.y + 0.1),
        `organized cards overlap: ${a.id} and ${b.id}`);
    }
  }
  const cards = new Map(geometry.cards.map((card) => [card.id, card]));
  const expectedEdges = geometry.cards.filter((card) => cards.has(byId.get(card.id)?.parent_id)).map((card) => card.id).sort();
  assert.deepEqual(geometry.edges.map((edge) => edge.id).sort(), expectedEdges,
    "every visible parent-child relation has exactly one curve");
  const occupied = new Map();
  for (const edge of geometry.edges) {
    const parent = cards.get(byId.get(edge.id)?.parent_id), child = cards.get(edge.id);
    assert(parent && child, "each connector belongs to two canvas cards");
    const right = child.x + child.w / 2 >= parent.x + parent.w / 2;
    const start = { x: parent.x + (right ? parent.w : 0), y: parent.y + parent.h / 2 };
    const end = { x: child.x + (right ? 0 : child.w), y: child.y + child.h / 2 };
    for (const axis of ["x", "y"]) {
      assert(Math.abs(edge.start[axis] - start[axis]) < 0.1, `connector ${edge.id} starts at the parent side center`);
      assert(Math.abs(edge.end[axis] - end[axis]) < 0.1, `connector ${edge.id} ends at the child side center`);
    }
    assert.match(edge.d, /^M [-\d.]+ [-\d.]+ C [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/,
      "each connection is one cubic Bezier curve");
    occupied.set(parent.id + ":" + (right ? "right" : "left"), start);
  }
  assert.equal(geometry.ports.length, occupied.size, "one shared dot exists per occupied parent side");
  for (const dot of geometry.ports) {
    const start = occupied.get(dot.parentId + ":" + dot.side);
    assert(start, "each dot belongs to an occupied parent side");
    assert(Math.abs(dot.x - start.x) < 0.1 && Math.abs(dot.y - start.y) < 0.1,
      "shared dot remains on the parent side center");
    occupied.delete(dot.parentId + ":" + dot.side);
  }
}
