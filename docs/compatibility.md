# Data and protocol contracts

Rabbithole currently has one canonical representation at every persistence
boundary. Inputs must match the current representation; the codebase does not
carry format-upgrade paths.

## Persisted holes

Backend document records use `schema_version: 2`. The runtime authority
is `src/core/schema.js`:

- `toPersistedHole` creates the canonical record written by the bridge store.
- `parsePersistedHole` clones and validates untrusted records.
- `validatePersistedHole` enforces the current document and node shape.

Missing, null, or unsupported schema versions are rejected. A version greater
than the current version fails with the explicit update-to-open message before
the record is mutated.

Persisted nodes contain Markdown source, base-URL provenance, origin metadata,
layout and read state, timestamps, and an `extensions` object. Rendered HTML is
derived and is never persisted.

### Markdown dialect

Rabbithole uses GFM with one deliberate ambiguity removed: strikethrough
requires double tildes (`~~deleted~~`). Single tildes remain literal so common
approximation notation such as `~77%`, `~zero`, and `~1,000` cannot pair across
an arbitrary span and silently render intervening prose as deleted. Escaped
tildes and tildes inside code retain their normal Markdown behavior.

This rule belongs to the shared renderer and therefore applies identically to
live canvases, browser documents, Node rendering, and newly generated frozen
snapshots. Markdown source is not rewritten.

## Portable files and snapshots

Portable `.rabbithole` files use this envelope:

```json
{
  "format": "rabbithole",
  "format_version": 1,
  "hole": { "schema_version": 2 },
  "assets": {}
}
```

Imports validate the envelope, size caps, asset names and bytes, and the current
hole schema before writing anything. Identity collisions receive a fresh hole
ID. Partial imports are removed if asset persistence fails.

Snapshot HTML is self-contained and carries the same portable envelope in one
inert `application/vnd.rabbithole+json` script element. Snapshot projection:

- includes only referenced assets;
- clears personal extensions while retaining note and canvas presentation;
- includes the shareable canvas view;
- contains no credentials, settings, live transport, or external assets.
- embeds the pinned Mermaid runtime only when a node contains a Mermaid fence,
  preserving offline diagram rendering without changing the portable payload.

The frozen client derives hydration exclusively from that portable payload.

## Local storage

The paired bridge owns `documents/<hole_id>/hole.json`, binary
`documents/<hole_id>/assets/<name>`, and `staging/<ingest_id>/<name>` under
`RABBITHOLE_DIR` (default `~/.rabbithole/`). Summaries derive from hole records.
The browser's `HttpStore` uses authenticated GET/POST `/bridge/store/` routes;
asset uploads/downloads carry binary bytes with filename-derived MIME types.
Completed saves replace the hole record before HTTP acknowledgment. There is no
IndexedDB document adapter, data migration, offline cache or synchronization.
Whimsical `hole_id` values locate documents within that bridge, not network share
tokens.

Model choices and bridge pairing use `rh-web-settings`, separate from document
storage. The local `backend_conversation` extension stores backend, sessionId and
scopeId only after successful generation. Portable projections remove it without
mutating live state. Settings and session references have no migrations.

## Generation protocol

The authenticated loopback `/bridge/generate` endpoint accepts backend, model,
reasoning, optional sourceSession and semantic input. Tasks are explain, author,
and ask. The bridge owns product instructions. Every request creates a
persistent session or forks its source; completion carries the new session apart
from article text. Text, search, completed and error are native SSE event types.
EOF alone fails. Missing history, scope and backend mismatch fail explicitly.

## Security and resource limits

Markdown source is authoritative. Live and frozen rendering share the same
sanitizing renderer, reject unsafe URLs, and keep imported HTML inert. Portable
imports enforce file, payload, node, asset-count, per-asset, and aggregate-byte
caps before decoding expensive data.

The contract suites covering these boundaries are:

- `test/contracts/data-boundaries.test.mjs`
- `test/contracts/artifact-roundtrip.test.mjs`
- `test/contracts/backend-store.test.mjs`

## Changing a format

Until Rabbithole makes a public backward-compatibility promise, a format change
should update the canonical schema, producers, consumers, fixtures, and docs in
one change. Do not add speculative upgrade code. Keep future-version refusal so
newer data can never be reconstructed lossily by an older binary.
