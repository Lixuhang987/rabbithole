# Fork cache affinity implementation plan

User-authorized follow-up to native session unification. Baseline: `8d5a4f0`.

## Flow and contracts

Selecting text in a generated article still creates a native fork. Root,
sibling and descendant threads keep distinct native IDs and histories, but
outgoing Responses requests share the root `Session-Id` and `prompt_cache_key`.
`Thread-Id` and turn metadata retain the actual child identity. Sharing identity
allows cache reuse; identical prefixes and upstream policy still determine hits.

Existing `/bridge/generate` → `CodexAppServer.turn` → start/fork → turn/start
flow remains authoritative. Resolve source ancestry with metadata-only
`thread/read` before forking, and register the resulting thread before turn/start.
A process-local thread → root map is an optimization; native `forkedFromId`
metadata restores it after restart. Missing ancestry fails explicitly. No new
portable or IndexedDB fields and no user configuration writes.

A bridge-owned loopback HTTP proxy forwards to the effective Responses provider.
Its random private URL is available only in per-thread runtime configuration;
browser-origin requests are refused. Preserve provider authentication, headers,
queries, paths, errors and SSE backpressure. Disable WebSockets and request
compression on these runtime requests. Rewrite only Session-Id and the JSON cache
key; unrelated provider endpoints stream through. Track connections for abort
and shutdown. Use the built-in OpenAI endpoint appropriate to the account when
no explicit URL is configured. Non-Responses providers retain native transport.
Completion metadata preserves native cached-input counters for verification.

## Integration first and test budget

Extend `test/isolation-live/codex-isolation.test.mjs` with installed-Codex
root/sibling/descendant/restart cache identities and distinct native IDs; retain
search, configuration and tool isolation coverage; also exercise the built-in
OpenAI endpoint override with a local offline endpoint. Update stale installed-tool
shape assertions only as needed to run that existing coverage.
Extend fake app-server config/read and thread/read support used by existing
`test/integration/bridge-http.test.mjs` (independent imports, forks, restart,
cancel/retry, large input and unchanged user configuration).
Add one integration case for private proxy transport: concurrent families,
UTF-8 large requests, SSE streaming, abort, shutdown and upstream error status.
Cumulative new independently executed tests: 1 (maximum 4). No standalone tests
asserting removed behavior; supported proxy access checks remain in transport flow.

## Work

1. Record existing baseline failures and expected cache-identity test red.
2. Implement private proxy, provider runtime overrides and ancestry resolution.
3. Preserve cached usage metadata and update current architecture boundary.
4. Run affected integration, installed-binary acceptance, types and default suite;
   regenerate module docs. Browser source is unchanged, so no browser rebuild.
5. Verify actual cache reuse with fresh synthetic forks against the configured
   upstream, distinguishing this evidence from deterministic transport tests.

## Evidence

- Setup succeeded. Full baseline was interrupted after recording the existing
  purity failure and runtime timing failures; it is not claimed complete.
- Integration-first red: the transport case fails with module-not-found before
  implementation. Installed-baseline Ego tool-shape assertion was stale; updated
  its coverage to read both ordinary and Responses Lite tool declarations.
- Green: proxy transport (large UTF-8, concurrent families, SSE, errors, browser
  exclusion, cancel/shutdown); native bridge HTTP; native bridge failures; bridge
  unit coverage. Completion includes native cached counters.
- Installed Codex 0.162.1: root, sibling, descendant across two restarts retain
  independent Thread-Ids and shared root Session-Id/key. Search and Ego roundtrips
  and unchanged config pass; built-in OpenAI endpoint override also passes offline.
- Real configured upstream, synthetic input, fresh forks requested once each:
  root 27,102 input / 0 cached; child and sibling each 27,120 / 27,008;
  restarted descendant 27,138 / 27,008. Four distinct native threads. Disposable
  homes removed after validation. This demonstrates this provider chain's reuse,
  not a general upstream caching guarantee.
- Real product explain → selected-text Ask, with their different product
  instructions: root 27,399 / 0 cached; fresh child 27,457 / 27,264 (99.3%).
- Source/test/strict types pass. Generated module/test documentation regenerated.
  Final default `npm test -- --fail-fast`: 3 passed, 1 failed, 76 skipped; the same
  existing purity deadline check fails. Full suite is not claimed green.
- New independent test count: 1. No browser source changes or browser rebuild.
