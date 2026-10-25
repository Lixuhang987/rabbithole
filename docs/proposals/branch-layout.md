---
status: accepted
date: 2026-10-25
---

# Branch organization and clear connector lines

## Confirmed goal

Readers need branches to remain visually distinct when the canvas is organized.
Document cards must not obscure other branches' connector lines. See
[Product](../../PRODUCT.md) for the durable product constraint.

## Confirmed layout decisions

- Automatic organization and explicit Tidy use the same spatial rules.
- Relationship depth determines the horizontal column. All direct children
  appear one column to the right, including whole-article follow-ups. Terminal
  leaves at different depths remain in different columns.
- Reserve each subtree the larger of its own rendered card height and the sum
  of its children's reserved heights plus sibling gaps. Center the parent and
  its child group within that reserved area. Two tree passes are sufficient;
  contour packing and pairwise collision optimization are not required.
- The parent is centered over its child branches' combined reserved space.
  Direct children need not have equal distances from their parent.
- Each branch retains a continuous reserved region, including descendants.
  Fixed depth columns may still be tall when a parent has many leaf children;
  leaf wrapping or extra visual layers are outside this chosen layout.
- Manual dragging remains free. The unobstructed-connection guarantee applies
  to organized results, not arbitrary hand-arranged positions.

Card placement and connector routing must be designed together. Nonoverlapping
card rectangles alone do not guarantee unobstructed connections.

## Confirmed interaction decisions

The reader accepted these interaction rules, including the source-order
exception required for strictly noncrossing connectors.

1. Reflow triggers: when Auto-tidy is enabled, reflow after graph changes,
   folding, expansion, or settled size changes; avoid reflow for each streamed
   token. With it disabled, preserve free positioning until explicit Tidy.
   Automatic reflow keeps unaffected root trees in place as obstacles; an
   explicit Tidy is the operation that globally realigns every depth column.
2. Folding: retain descendant cards as title bars rather than hiding the tree.
   When automatic organization is active, expansion recomputes layout instead
   of restoring stale pre-fold coordinates. Keep existing fold eligibility and
   exemptions for unread, active, pinned, drafting, or pending work.
3. Movement and camera: automatic reflow may reposition sibling branches in
   the affected tree, but preserves the engaged card's screen position and zoom.
   Explicit Tidy frames the organized canvas. Manual positions may be replaced
   by the next automatic reflow while Auto-tidy is enabled.
4. Sibling order: order anchored child branches by their source quotation's
   vertical document position. This takes precedence over creation order when
   the two conflict. Retain stable order for equal or absent anchors and keep
   descendant groups contiguous; do not reorder by size or title.
5. Connectors: use reserved inter-column channels with rounded orthogonal paths,
   retaining true parent/child endpoints, source quotation anchors, and arrows;
   a monotone source fan-in preserves ordered ports before entering each
   orthogonal channel.
   Organized connectors must not cross one another or pass through unrelated
   document cards. Connections may meet at the same genuine source anchor.
6. Other surfaces: explicit Tidy includes independent notes and other root trees
   as separate vertical blocks. Automatic reflow treats unrelated manually
   placed cards as obstacles. Docked notes remain part of their parent surface;
   their visible footprint must be considered for clearance. Pinned windows
   retain screen positions while their canvas proxies participate in layout;
   floating window overlays are outside the canvas-line clearance guarantee.

Implementation and verification are tracked in
[the implementation plan](../plans/centered-branch-layout.md).
