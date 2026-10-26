# Folded card hover preview implementation

Implements the [presentation contract](../proposals/folded-card-hover-preview.md).
Baseline: `722d433`; no schema, portable-data or generation-contract changes.

## Use case and boundaries

Source card header hover → 300ms delay → centered inert document excerpt.
The original card alone owns hover. Pointer exit/action, mode changes and
teardown close the excerpt. The shared overlay stack suppresses previews while
an interactive surface owns input. Plain Tab while visible calls `openNode(id)`,
the existing Expand document entry, without changing the node's collapsed state.

Use the existing `node.collapsed`, `node.bodyEl` and rendered origin/document
surfaces. Clone their presentation rather than mounting a second live document
surface with duplicate media ownership. The clone has no independent model,
editable controls, persistence or media lifecycle. Give cloned markup unique
IDs and preserve rendered canvas pixels. The canvas lifecycle owns delegated
listeners, timers, active observers and teardown; actual pinned cards use the
same delegation, inert proxies do not.

Folded CSS hides the complete body again. The excerpt lives outside the
transformed world, uses enlarged text and a maximum 80vh height, and measures
overflow for a conditional fade. Hover must work through the overlay even when
it visually overlaps the source tab. No hover or Tab shortcut starts on touch.
Cards without an Ask origin retain the agreed title-only behavior.

## Test selection and implementation

- Extend `test/e2e/auto-tidy.test.mjs`: verify compact automatic/manual folds,
  complete origins through hover, reload and frozen snapshot parity; preserve
  settings, attention, grace-clock and reader-origin coverage.
- Add `test/e2e/folded-hover-preview.test.mjs`: one browser journey through
  long-body clipping, preview geometry and enlarged text, inert media, leaving
  the trigger, keyboard expansion, modifier/typing exclusions, pinned cards,
  original header actions and lifecycle dismissal. Reuse real app/provider
  boundary fixtures; no mocks of the preview or document-opening flow.
- Cumulative new-test budget: one independently executed browser file.
- Update tests first, implement a canvas-owned hover controller and fold CSS,
  then run focused tests, build, generated docs and the full suite.
- Inspect the running preview visually; run Standards and Spec reviews against
  the baseline, fix findings, regenerate committed output and commit.

No negative-only test is planned; assertions follow supported browsing flows.

## Delivery verification

Build, generated documentation and committed bundles are consistent. The final
full suite passes 74 checks with zero failures, including performance budgets.
Light and dark preview screenshots were inspected. Standards and Spec reviews
have zero unresolved findings after the menu-keyboard ownership fix.
