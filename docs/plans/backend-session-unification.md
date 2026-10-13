# Backend session unification execution plan

Implements the accepted [spec](../proposals/backend-session-unification.md).
Baseline: `032631461f3f42ab9545b73c94fbcaee0af639e4`.

## Use cases and contracts

- Root/author: host → bridge provider → POST `/bridge/generate` → Codex
  thread/start + turn/start → completed event → persist article and session.
- Generated article Ask: host reads source association → same endpoint with
  sourceSession → Codex thread/fork + turn/start → persist child association.
  Siblings inherit the source independently; descendants inherit their parent.
- Imported Markdown/PDF Ask: no source association → create with full readable
  article and current Ask → persist only the answer's association. Each Ask is
  independent; asking that answer subsequently forks it.
- PDF conversion: current model → same create contract for each page batch →
  text/progress → existing conversion and asset lifecycle.
- Cancellation/retry: host Run identity guards binding; a retry repeats create
  or forks the original source. Native-history errors fail without rebuilding.

Request fields: backend, model, reasoning, optional sourceSession, input.
Input kinds: explain, author, ask, transcribe. Each carries task data, never a
caller-supplied system message. Bridge selects product instructions.
Session reference: backend, sessionId, scopeId; extension: backend_conversation.
Stream events: text, search, completed (session and optional usage), error.
Only completed validates and releases a conversation event to the host.

Existing flows to replace: OpenAICompatibleProvider, Codex-only conversation
opt-in, imported baseline injection/recovery, mixed provider Model settings,
public MCP server/host/CLI. Keep Codex app-server, browser host, shared renderer,
portable artifacts, ingestion and bridge-owned Ego browser tool.

## Integration tests first

Reuse `test/integration/bridge-http.test.mjs`: root ownership, siblings and
descendants, reopen/restart, current settings, imported concurrent Asks, image
parts, cancellation and retry. Replace baseline assertions with independent
thread/start and complete imported-input assertions. Update its HTTP helper
and provider construction before implementation; verify the expected red.

Reuse `test/integration/generation-lifecycle.test.mjs`: arbitrary stream
fragmentation, terminal metadata, titles, attempt identity, disposal, root and
author persistence. Replace OpenAI fixtures with native bridge events.

Reuse `test/integration/bridge-failure-modes.test.mjs` for Codex errors and
cancellation, `codex-ego-browser.test.mjs` for retained internal browser tools,
PDF/import/artifact tests for retained assets, and `test/e2e/web-app-setup.test.mjs`
plus existing branching/sharing journeys for setup and user interaction.
Update `test/packaging/install-smoke.test.mjs` to install and start the bridge.

New independent tests planned: 0; cumulative maximum: 4. Skip standalone
negative tests asserting removed MCP/endpoints/migrations are absent; remove
obsolete tests and keep meaningful core assertions from mixed suites.

## Implementation tasks

1. Replace conversation references and host baseline/recovery with source lookup.
2. Introduce native provider/event protocol and bridge task input validation;
   replace generic transcript assembly with purpose-specific product prompts.
3. Codex always creates persistent threads or native forks and returns sessions.
   Remove injection and stateless paths. Preserve browser tools and isolation.
4. Replace model/settings UI with Codex discovery, model/reasoning controls,
   pairing/reconnect/restart and current-model vision capability. Update app setup.
5. Remove public MCP and direct-provider modules/fixtures/commands. Extract shared
   source-reading support before deleting the MCP asset loader. Keep SDK/zod for
   internal browser tooling. Update mixed tests and structural checks.
6. Update operational/product docs and generators; build committed artifacts.
7. Run relevant tiers, required structural checks and `npm test`; inspect UI where
   feasible. Run Standards and Spec reviews against the pinned baseline in
   parallel, fix actionable findings, reverify affected checks and commit.

## Fork cache affinity follow-up

Accepted follow-up: preserve independent native histories while sharing the
root request cache identity. See [implementation plan](fork-cache-affinity.md).

## Verification record

Record baseline, red/green results, final checks and review results here as work
progresses. Installed-Codex acceptance is opt-in and must be identified separately
from deterministic fake-app-server evidence.

- Setup: repository-local worktree and dependencies ready.
- Original `npm test` baseline: 102 passed, 4 failed. Prompt contract expects
  removed note-attribution copy; start-composer Enter submission failed;
  Model setup timed out on a hidden input; clean package installation cannot
  resolve `dompurify@^3.4.11`. Full log: `/tmp/rabbithole-backend-baseline.log`.
- Integration-first red: updated existing native bridge HTTP scenario fails
  because the planned bridge provider does not yet exist. No production code
  had been changed at that point. User then authorized proceeding and ignoring
  known baseline failures.
- Native bridge HTTP integration green: create/fork, imports, persistence,
  completion binding, cancellation/retry and isolation verified against the real
  loopback bridge and fake Codex app-server. New independent tests: 0.

- Implementation complete: one semantic request and terminal-session protocol,
  Codex persistent create/fork, local associations and portable stripping, minimal
  Model setup, and current-model PDF transcription. Public MCP, direct endpoints,
  transcript/baseline compatibility, implicit image-dropping retries, host-backed
  preferences, and old agent liveness/delegation state were removed. Claude Code
  and OpenCode remain TODOs.
- Review corrections: preset-only whole-article Asks are valid intent; unconverted
  PDFs require a text version before Ask or note-to-Ask conversion. These gates
  run before optimistic creation/upload and at the host. Notes remain available.
- Latest deterministic native checks: bridge HTTP, bridge failure modes,
  generation lifecycle and data boundaries pass. Native HTTP also covers
  preset-only and image-only requests. Browser Model setup passes pairing,
  model/reasoning, reconnect/restart, native siblings and cross-tab pairing.
  Image/snapshot journey passes with browser persistence semantics.
- Builds and required checks pass: source/test types, CSS integrity, design and
  generated token documentation, icons, UI formatting/architecture, purity,
  generated docs, and committed dist regeneration.
- The default suite was run during cleanup: 61 passed, 18 failed. Log:
  `/tmp/rabbithole-native-final-suite.log`. Later targeted checks fixed the type,
  design, formatting, preference, mock-stream and snapshot failures. Remaining
  legacy PDF/browser journey expectations and packaging registry resolution are
  recorded rather than blocking this destructive refactor, as requested by the
  user. The full suite is not claimed green.
- Parallel code-review against the pinned baseline: Standards 0 actionable
  findings. Spec initially found preset intent and PDF prerequisite gaps; after
  correction, 0 unresolved runtime/spec findings. Final review covered the
  removal of obsolete MCP UI paths and fork scope validation.
- New independently executed cases added: 0. Installed-Codex live acceptance was
  not run; fake app-server protocol evidence is distinct from installed-binary
  and real-provider acceptance.
- Final focused rerun: article/session HTTP, stream lifecycle, Model setup and
  image snapshot suites pass. Artifact portability/publish and fetch-proxy policy
  contracts also pass after updating the surviving bridge fixtures and current
  documentation expectations. Full default suite was not rerun after these fixes.
