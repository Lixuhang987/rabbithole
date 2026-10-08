# Codex node thread fork execution plan

Implements the accepted [local spec](../proposals/codex-node-thread-fork.md).
Article/note change synchronization and turn checkpoints are excluded.

## Use case flow

1. Root article creation: DirectHost generation → subscription provider's
   opt-in create request → bridge → persistent Codex thread → terminal
   conversation metadata → host stores association with the answered article.
2. Ask on an article: host reads its association → if absent, coalesces one
   baseline request for that source → bridge starts a persistent thread and
   injects necessary context without a model turn → host stores source ID →
   provider submits incremental Ask → bridge forks source → model response →
   host stores completed child's ID. Siblings fork source, descendants fork child.
3. Stale history: pre-generation unavailable error → new host Run identity →
   one baseline rebuild → independent fork. Failures after model execution,
   cancellation, and superseded runs never bind a child association.
4. Reopen and share: local hydration keeps associations; portable import/export
   and snapshots remove only the local conversation namespace.

## Contracts and implementation tasks

- Node extension: codex_conversation = version 1, threadId, scopeId.
- Shared value helper normalizes optional references and strips only this
  namespace at portable boundaries; do not add schema migration or revision data.
- Opt-in request: rabbithole_conversation with version 1, operation
  create/baseline/fork, nodeId, and (fork only) source reference.
  Baseline is a non-streaming phase on the existing endpoint, with context-only
  messages; it returns the source reference without running the model.
- Streaming completion: rabbithole.conversation with nodeId and validated
  reference. Provider requires terminal completion and DONE before emitting
  completed metadata. Non-streaming responses include equivalent metadata.
- Codex adapter owns a stable scope file inside the configured Codex history directory, persistent
  start/inject/fork and runtime release. Missing/archived source errors are
  translated before turn/start; all current isolation settings are overridden.
- Prompt builder supplies context-only bootstrap and incremental Ask messages,
  preserving attachments and current visual-block source.
- Provider enables metadata only for subscription Codex. Host coalesces
  baseline preparation per source/provider, interrupts abandoned waits, captures
  settings, and persists completed metadata under the current attempt guard.
- Generation adaptation intercepts metadata outside Run's text accumulator.
  Reducer completion preserves the supplied conversation extension atomically.
- Finish by rebuilding committed bundles, documenting shipped boundaries,
  reviewing the task diff, and applying only this task's changes to the original
  checkout, preserving its pre-existing work.

## Test selection and budget

Reuse/extend existing script cases; cumulative new independently executed tests: 0.
Do not add fine-grained helper tests or tests for excluded synchronization.

- test/integration/bridge-http.test.mjs: existing DirectHost/provider/real
  bridge/fake-Codex flow; extend it with generated and imported source branching,
  siblings/descendants, concurrent baseline preparation, restart/reopen,
  missing-history rebuild, cancellation/retry, and portable exclusion.
- test/integration/fixtures/fake-codex.mjs: durable external history and
  start/inject/fork/unsubscribe protocol support, with recorded inherited items.
- test/integration/generation-lifecycle.test.mjs: extend existing stream
  fragmentation/title handling for conversation events and truncation.
- test/contracts/artifact-roundtrip.test.mjs and data-boundaries.test.mjs:
  extend existing persistence/export/import cases to verify the namespace
  boundary and unrelated-extension preservation.
- Existing browser bridge fixture/journey: update subscription SSE metadata
  where necessary and verify selection/follow-up still dispatch correctly.
- Existing opt-in Codex isolation test: verify persistent injection/fork keeps
  capabilities restricted; run only when installed-agent access is available.

## Verification order

Baseline: npm test; fix the pre-existing map(JSON.parse) test type error before
feature edits. Then failing integrated assertions → minimal vertical slices →
focused integration/contracts plus check:types → npm run build → npm test →
task-only diff review. Track baseline failures separately; no unrelated cleanup.

## Delivery evidence

Focused bridge, generation lifecycle, artifact roundtrip, data-boundary, browser
selection/follow-up, and installed-Codex loopback checks pass. The live check
covers persistent baseline injection without inference, two restarts, ancestor
answer inheritance, and retained capability isolation. Standards review found
no breach; spec review found a frozen-hydration omission, now fixed.
Delivered to the original checkout, retaining its concurrently committed bridge
restart controls. Types, UI lint, affected suites, browser Asks, and installed
Codex acceptance pass. Final review confirms the fixes and merged contracts.
Full-checkout suite: 99 passed / 6 failed; merge-related type/bridge failures
were fixed and their reruns pass; Enter timing failed once and its rerun passes.
Remaining baseline failures: prompts (removed authoring vocabulary), web-app
notes (read/edit/read geometry), install smoke (dompurify registry ETARGET).
No unrelated prompt, canvas-note, or dependency changes were made to hide them.
