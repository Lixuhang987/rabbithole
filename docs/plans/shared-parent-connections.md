# Shared parent connections implementation

Approved behavior: [Branch organization](../proposals/branch-layout.md).
Review base: `722d433e3e7c9232956f4a9d619849c7ce9ef7a5`.
Workspace: `.worktree/codex/shared-parent-connections`.
Branch: `codex/shared-parent-connections`.

## Use cases and flow

1. Explicit Tidy and automatic organization: existing measured/source-ordered
   entries → `layoutBranches()` → independently centered depth columns with
   contiguous direct-child clusters → positioned/persisted cards. Use 30 within
   clusters, 90 between clusters, fixed 70 between columns. Preserve affected
   tree collision handling, camera anchoring and root separation.
2. Draw/drag/resize/fold/pin: parent and child canvas rectangles → horizontal
   center side selection → side-center ports → one cubic path per child and
   one shared dot per occupied parent side. Geometry never reads source marks.
   Remove the alternate routing modules and lane-dependent column sizing.
3. Hover: card → incoming edge plus source marks and direct outgoing edges;
   source mark → its own edge, taking precedence over the containing card's
   cluster emphasis. Leaving the mark restores a still-hovered parent. A
   shared dot is highlighted while any associated edge is highlighted.
4. Source scrolling and reopening: preserve source navigation/order and docked
   note positioning, but not scroll-driven edge geometry. Saved coordinates
   and frozen snapshots reproduce the same shared-port cubic connections.

## Contracts and ownership

- Core layout retains `{id,parent_id,width,height}` input and
  `{positions,columns,trees}` output; no persisted schema changes.
- Pure core remains independent of Node and DOM. UI owns measured canvas
  rectangles and SVG rendering. Routing is local per edge; port-dot ownership
  is parent/side, independent of child-path ownership and lifecycle.
- Keep source-mark measurements for ordering and quotation feedback only.
- Retain existing public canvas scheduling/highlight entry points where useful;
  remove unused endpoint/orthogonal helpers rather than compatibility wrappers.
- Main checkout's unrelated folded-preview changes are outside this commit.

## Test selection and budget

Cumulative new-test count: 0 planned; ceiling: 4 independently executed cases.
Update existing cases before implementation:

- `test/integration/branch-layout.test.mjs`: compose real layout for mixed
  parents, heights and depths; prove exact cluster/column gaps, independent
  column centering, source input preservation, root separation and folding.
  Retire orthogonal-route expectations with their removed routing contract.
- `test/e2e/branch-layout.test.mjs`: retain source ordering, follow-up depth,
  notes, drag, reload and frozen journeys; assert shared center ports/cubic
  geometry, stable ports on source scroll, cluster gaps, per-side dots,
  left/right dragging, exact horizontal ties in a frozen artifact fixture,
  and overlapping card/quotation hover.
- Adjust shared geometry helpers to preserve card-overlap assertions and expose
  supported connector geometry, retiring strict connector-clearance checks.
- Reuse existing auto-tidy, edge-scroll and branching journeys for regressions.
  Exercise the hover exemption with actual pointer entry/exit, so browser
  hit testing and the synthetic clock describe the same interaction.
  Do not add negative tests for removed routing modes or arbitrary clearance.

## Execution and verification

Establish dependency setup and full clean `npm test` baseline before code.
Observe the changed integration/browser expectations fail, implement the
simplified layout/renderer, then run focused integration/browser journeys.
Regenerate `dist/` and generated docs; run `npm run build` and `npm test`.
Pin the review to the base above and run Standards/Spec reviews in parallel.
Fix actionable findings, rerun affected checks, and commit on the task branch.

Verified results:

- Clean baseline and final serial `npm test`: 73 passed, 0 failed each.
- Focused layout, branching, source-scroll, notes and auto-tidy regressions:
  7 passed, 0 failed. The final real-pointer auto-tidy case also passed alone.
- A parallel test sweep exposed an intermittent synthetic-hover auto-tidy
  timeout. Diagnostic probes did not establish a production defect; the
  existing case now enters and leaves the card with the real pointer.
- `npm run build`, `npm run build:docs`, `npm run check:docs`,
  `npm run check:dist` and `git diff --check` passed.
- Standards and Spec reviews against the fixed base have no unresolved
  findings. The Standards performance observation was addressed by collecting
  hover state once per batch and refreshing shared dots after the batch.
- Browser DOM checks confirmed cubic paths, shared parent dots and cluster
  spacing. Screenshot capture was unavailable; no screenshot acceptance is
  claimed.
