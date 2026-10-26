---
status: accepted
date: 2026-10-26
---

# Branch organization and shared parent ports

## Goal

Readers must recognize which parent owns each group of documents in a depth
column. See [Product](../../PRODUCT.md) and **Child cluster** in
[Context](../../CONTEXT.md).

## Confirmed behavior

- Keep independently centered depth columns. A cluster consists only of one
  parent's direct children; do not reserve recursive subtree regions or align
  every parent to its own child cluster's midpoint.
- Pack siblings with a 30-unit gap, separate different child clusters by 90,
  and keep a fixed 70-unit gap between depth columns. Use the same canvas-unit
  gaps for expanded and folded cards. Keep independent root trees separate.
- Preserve quotation/source order, with stable creation order for equal or
  absent anchors. Whole-article follow-ups use the next depth column too.
- Each parent has at most one shared center port per side. Compare horizontal
  card centers: right-side children connect parent-right to child-left;
  left-side children connect parent-left to child-right. A horizontal tie uses
  parent-right. Never use top or bottom ports. Organized children are rightward.
- Draw one full cubic Bezier curve per child, sharing only the parent endpoint,
  without a common trunk. Draw one dot per occupied parent side; remove the
  quotation-anchored dot color distinction. Keep the existing neutral stroke
  and hover accent; do not add arrowheads or relation labels.
- Hovering a card highlights its incoming connection and the matching source
  quotation, and also its direct children's outgoing connections. Hovering a
  quotation highlights only its corresponding connection. Removing geometric
  quotation anchoring does not remove source navigation or text highlighting.
  Quotation hover takes precedence over the containing card's cluster emphasis.
- Scrolling source text does not move connector ports. Fold, resize, drag and
  pin changes still update endpoints using the canvas card or canvas proxy.
- Remove orthogonal routing, bend lanes, channel reservations and inferred
  routing-mode detection. Preserve card-overlap prevention during automatic
  organization and initial child placement.
- Connector clearance is no longer a hard guarantee. Large size differences
  or arbitrary free positioning may produce crossings or paths through cards.
  Tidy improves grouping and readability without routing around obstacles.
- Automatic organization and explicit Tidy use the same cluster rules. Keep
  existing trigger, camera anchoring, folding and independent-tree behavior.
  Live documents and newly exported frozen snapshots share the visual rules;
  existing frozen exports remain unchanged. No portable data change is needed.

This replaces the previous quotation-anchored orthogonal routing design.
Implementation and verification: [Shared parent connections](../plans/shared-parent-connections.md).
