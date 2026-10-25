# Centered branch layout implementation

Approved behavior: [Branch layout](../proposals/branch-layout.md). Review base:
`5a568c07d64503ce7a310da633e61dfe02d29449`. Worktree and task branch:
`.worktree/codex/centered-branch-layout`, `codex/centered-branch-layout`.

## Use cases and existing flows

1. Explicit Tidy: toolbar/keyboard → `canvas/tidy.js` → measured canvas cards →
   shared layout kernel → positioned cards and routes → bulk persistence →
   frame canvas. Include all parentless trees and independent notes.
2. Automatic organization: graph registration/removal and rendered size changes
   → live maintenance → coalesced affected-tree reflow → reserve space against
   unrelated cards → persist moved nodes. Preserve the engaged card's screen
   location and camera scale; do not reorganize on drag position changes alone.
3. Automatic folding: existing warmth, grace, and exemption policy → fold state
   changes → same layout. Expansion in automatic mode recomputes instead of
   restoring stale stack coordinates. Free-positioning mode retains its manual
   fold/restore behavior until explicit Tidy.
4. Connectors: source-ordered siblings and separated depth columns → routed
   ordered fan-out in inter-column channels → SVG rendering. Keep source
   quotation endpoints, highlights, and updates on content scroll. A genuine
   common source can be shared; transverse intersections and unrelated card
   intersections are forbidden in organized results.

## Contracts and ownership

- Pure core layout consumes ordered entries `{id,parent_id,width,height}` and
  returns positions, column geometry, and per-tree bounds. It neither mutates
  documents nor reads the DOM. Subtree height is the maximum of the own card
  height and the sum of child subtree heights plus gaps.
- Pure route generation consumes source/target points in vertical order and
  channel bounds. It returns SVG paths. Channel widths reserve separate bend
  lanes; coincident source anchors fan out without introducing crossings.
- The UI owns effective card dimensions, source ordering, graph filtering,
  unrelated-card obstacle bounds, camera anchoring, and bulk persistence.
  Pinned canvas proxies participate; floating windows retain screen positions.
  Docked-note marks remain within their parent surface's footprint.
- Live automatic scheduling is injected through existing canvas maintenance.
  Frozen snapshots share layout/routing but exclude auto-fold preferences,
  scheduling, and bridge traffic. No portable schema change or new setting.
- Retain free-drag edge behavior outside organized geometry. After reload,
  derive organized routes from saved positions rather than private persisted
  runtime metadata. Source scrolling must preserve ordered connections.

## Test selection and budget

New-test ceiling: 4 independently executed cases; planned additions: 2.

- Extend `test/e2e/auto-tidy.test.mjs`'s existing fold/settings journey to assert
  layered organization, fold/expand geometry, camera anchoring, and persistence.
  Preserve its unread, hover, pin, draft, enable/disable, and frozen coverage.
- Add one core integration case that composes layout and route generation for
  unequal card dimensions, mixed depths, and collapsed-size changes; assert
  centered reserved areas and geometry rather than implementation call counts.
- Add one browser journey for reverse creation/source order, manual Tidy,
  independent notes, free drag/resize, save/reopen, and frozen organized routes.
- Reuse existing canvas sharing/card-menu and edge-scroll journeys, preserving
  free-positioning fold restoration and pointer ownership regression coverage.

## Implementation and checks

Write the selected integration assertions first and observe their failure.
Implement the pure kernel and route geometry, then adapt Tidy and live
maintenance. Update shared fold/render hooks only at those seams. Verify the
selected flows before broader checks. Run `npm run build`, `npm test`, and
generated-doc checks; regenerate committed bundles and module docs. Review the
diff against the pinned base along Standards and Spec in parallel, fix findings,
and commit the reviewed result to the task branch.

## Baseline before implementation

Dependency setup passed. Full `npm test` at the review base produced 77 passed
and 6 failed; no layout implementation or test changes had been written.
`test/e2e/auto-tidy.test.mjs` passed. Existing failures were:

- `check:purity`: agent turn deadline count is zero rather than one.
- `integration/pdf-precision`: the Ask commit remains disabled.
- `integration/web-ingestion`: the Explain preset remains disabled.
- `e2e/web-app-sharing`: settings width measures 639px rather than 640px;
  its card-menu and reversible branch-collapse flow passed first.
- `performance/budgets`: mocked store response disposed during fulfillment.
- `packaging/install-smoke`: registry cannot resolve `dompurify@^3.4.11`.

The worktree skill requires user direction before implementation after a failed
baseline. Recommendation: proceed with the scoped layout change and compare
final results against these recorded failures. The reader explicitly approved
continuing with the layout change and recording the existing failures separately.
