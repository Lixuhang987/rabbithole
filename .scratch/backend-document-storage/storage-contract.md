---
status: ready-for-agent
date: 2026-10-22
---

# Local storage contract

This is the protocol and filesystem decision record for [the migration spec](spec.md). It describes the target implementation, not current behavior.

## Store interface and ownership

- Keep the existing `RabbitholeStore` method names and `SaveHoleOptions.updatedAt` behavior. `FsStore` owns canonicalization, validation, summary derivation, and disk access; `HttpStore` owns fetch/JSON/binary conversion. The core remains independent of HTTP, Node, and the DOM.
- Browser reads return canonical holes and `Blob` assets. Filesystem reads return canonical holes and Node `Buffer` assets. Both retain `getAssets`/`putAssets` conveniences; add their shapes to the shared declaration to match actual callers. They may compose existing single-asset operations and need no extra endpoints.
- An empty store lists `[]`; `loadHole` and `getAsset` return `null` when absent. Missing-document/asset deletion is idempotent. List summaries use existing `holeSummary` shape and descending `updated_at`, with `hole_id` as the stable tie-breaker. Asset names and adoption results sort lexically, matching current behavior.
- Saving replaces the complete hole, never merges nodes. The explicit `updatedAt` option wins; otherwise use the existing current-time rule. Reject an explicitly unsupported schema version before canonicalization can overwrite it, and preserve current future-version refusal on reads. Do not introduce record or portable-envelope versions.
- Asset and staging operations keep existing ownership semantics, byte limits, and error behavior. `putAsset` may create an asset directory before its hole is saved; only an actual hole record makes a document appear in the library. Preserve current import cleanup and deletion/undo orchestration in their existing callers.

## Filesystem layout

Resolve the root with the existing `bridgeDirectory(env)` helper: `RABBITHOLE_DIR` overrides `~/.rabbithole`. Documents live under `documents/`; import staging lives under `staging/`, beside the existing pairing token. Never place document storage in the temporary Codex working directory or static browser build directory.

| Relative path | Content |
| --- | --- |
| `documents/<holeId>/hole.json` | Canonical persisted hole, including local node conversation references |
| `documents/<holeId>/assets/<name>` | Original binary asset bytes |
| `staging/<ingestId>/<name>` | Temporary binary asset bytes pending adoption |

- Use existing hole/ingest ID and asset-name validators for every filesystem identifier. These schemas yield single safe path components. No arbitrary-path route, user-selected storage path, generic repository layer, or new database dependency is needed.
- `saveHole` uses one temporary sibling file followed by rename to replace `hole.json`; success is reported after replacement completes. Temporary files are never library entries. This is basic single-file writing, not a backup, journal, fsync, or crash-recovery feature.
- Derive summaries from saved `hole.json` records on list; do not introduce a summary database, persistent index, or cache invalidation protocol. Retain explicit parse errors for unsupported/malformed records rather than silently omitting documents.
- Asset content types derive from existing `getAssetContentType(name)`; bytes remain unchanged. Browser reads construct a Blob with that canonical MIME type. No sidecar MIME database is needed. Preserve original byte counts and allowed file/size rules.
- `createStaging` creates a unique directory. Uploads require that staging handle. `adoptStagedAssets` moves its files into the target asset directory, removes the staging directory, and returns adopted names. An unknown or empty handle fails as today; discard is idempotent. No expiry task, scanner, or recovery procedure is added.
- Deleting a hole removes its record and owned asset directory; deleting an asset removes that file. Keep native history outside this deletion scope. The existing single-editor serialized save flow is sufficient; no OS locks, revisions, or concurrent-writer coordination are required.

## HTTP contract

All paths below use the existing bridge base URL. Every storage request passes existing Host/Origin/Bearer checks, with existing CORS and local-address fetch hints. Storage is usable independently of backend model/authentication readiness. Mutations reply only after the underlying store operation finishes.

| Method | Path | Request → successful response |
| --- | --- | --- |
| GET | `/bridge/store/holes` | None → summary array |
| GET | `/bridge/store/holes/:holeId` | None → persisted hole or JSON `null` |
| POST | `/bridge/store/holes/:holeId` | JSON `{ hole, options? }` → `{ ok: true }`; options is the existing save options |
| POST | `/bridge/store/holes/:holeId/delete` | JSON `{}` → `{ ok: true }` |
| GET | `/bridge/store/holes/:holeId/assets` | None → asset-name array |
| GET | `/bridge/store/holes/:holeId/assets/:name` | None → binary bytes, or 404 when absent |
| POST | `/bridge/store/holes/:holeId/assets/:name` | Raw binary body → `{ ok: true }` |
| POST | `/bridge/store/holes/:holeId/assets/:name/delete` | JSON `{}` → `{ ok: true }` |
| POST | `/bridge/store/staging` | JSON `{}` → `{ ingest_id }` |
| POST | `/bridge/store/staging/:ingestId/assets/:name` | Raw binary body → `{ ok: true }` |
| POST | `/bridge/store/staging/:ingestId/adopt` | JSON `{ hole_id }` → adopted asset-name array |
| POST | `/bridge/store/staging/:ingestId/discard` | JSON `{}` → `{ ok: true }` |

- All JSON responses, including `null`, use the existing JSON response conventions. Store mutation responses use HTTP 200. A save's URL hole ID must match its record ID. Use existing ordinary 400/401/403/413/500 behavior and the bridge error envelope; no new error taxonomy is required. Map a missing binary GET's 404 to `getAsset() === null`; propagate other failures instead of treating them as absence.
- JSON POSTs use `application/json`. Binary uploads use the asset's canonical MIME type and must bypass the server's current unconditional POST JSON parser. Decode JSON as UTF-8 and read binary bytes without text conversion. Apply existing per-asset limits; do not reuse the generic 4 MB JSON body limit for full document saves or PDF uploads. Full-hole saves follow the existing unbounded generation-body convention so large supported articles remain saveable.
- Binary GETs set `Content-Type` from `getAssetContentType(name)` and the exact `Content-Length`. Mark store reads `Cache-Control: no-store` so ordinary HTTP caches cannot become a document authority. Use authenticated fetch followed by object URLs, not direct authenticated image URLs or base64 JSON payloads.
- Existing GET/POST/OPTIONS CORS support suffices. Do not add a second HTTP server, unauthenticated routes, public filesystem serving, new credentials, WebSockets, ETags, idempotency keys, resumable uploads, or a transaction protocol.
- `HttpStore.getAssets` lists names and fetches their bytes; `putAssets` uploads each supplied asset using these routes. Complete all started writes before resolving or reporting a batch failure, so existing import cleanup and undo logic cannot race outstanding writes. No additional batch atomicity is promised.

## Lifecycle and external verification

- Construct `FsStore` once for a bridge data directory. Recreating the bridge uses the same directory and rediscovers documents from disk. Storage routes do not call model discovery, start a native session, or depend on an agent being ready.
- Preserve the current CLI launcher/worker restart design already present in the working tree. Browser-initiated restart flushes pending document writes through the current host before requesting restart. Restart does not recreate, clear, migrate, or copy the document directory.
- Use temporary `RABBITHOLE_DIR` fixtures and the existing fake Codex app-server for deterministic bridge tests. The decisive observation is a saved document and attachment loaded through HTTP after process/browser replacement, plus a native fork from its retained conversation reference. Test the existing auth/origin and future-format boundaries at that same external seam; do not expose filesystem paths or debugging endpoints to browser clients.
