import { view } from "../core.js";
import { canvasBody, canvasCard } from "./shared.js";

// Saved height is a cap for short answers; folded cards still have descendants.
export function effH(node) {
  const card = canvasCard(node);
  return card?.offsetHeight || (node.collapsed ? 36 : node.size.h);
}

export function sourceMark(parent, child) {
  return canvasBody(parent)?.querySelector(
    'mark[data-child="' + child.id + '"], .rh-pdf-mark[data-child="' + child.id + '"]',
  );
}

export function firstMarkRect(mark) {
  return mark?.getClientRects()[0] || mark?.getBoundingClientRect() || null;
}

export function sourceOrder(parent, child) {
  const rect = firstMarkRect(sourceMark(parent, child));
  const body = canvasBody(parent);
  if (rect?.height && body) {
    // Unscrolled document coordinates keep sibling order stable while reading.
    return (rect.top - body.getBoundingClientRect().top) / view.scale + body.scrollTop;
  }
  if (parent.collapsed) {
    const anchor = child.origin?.anchor;
    const fragment = anchor?.pdf?.fragments?.[0];
    if (fragment) return fragment.page * 1e7 + (fragment.quads?.[0]?.[0]?.[1] || 0);
    if (Number.isFinite(anchor?.offset_start)) return anchor.offset_start;
  }
  return Infinity;
}

export function cardFootprint(node) {
  const card = canvasCard(node);
  const height = effH(node);
  let width = Math.max(node.size.w, card?.offsetWidth || 0);
  // Canvas note dots are clipped inside the body today. Measure any visible
  // margin extension as part of the parent if that presentation grows later.
  if (card) {
    const rect = card.getBoundingClientRect();
    for (const dot of card.querySelectorAll(".note-dot")) {
      const dotRect = dot.getBoundingClientRect();
      if (dotRect.bottom > rect.top && dotRect.top < rect.bottom) {
        width = Math.max(width, (dotRect.right - rect.left) / view.scale);
      }
    }
  }
  return { width, height };
}
