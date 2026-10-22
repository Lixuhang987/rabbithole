---
status: ready-for-agent
date: 2026-10-22
scope: specification-only
---

# Backend document persistence — destructive replacement spec

## Problem and solution

The installation owner lost access to browser-held conversation documents. The cause is unconfirmed, but browser storage must cease to be the sole durable copy. Store live documents, generated answers, node conversation references, and attachments on this computer through the paired bridge. Clearing browser site data must leave completed document saves intact; pairing again opens the same backend library.

Use the existing `RabbitholeStore` interface: browser document engine → `HttpStore` → authenticated loopback bridge → `FsStore`. The browser continues to own the active in-memory document graph and generation lifecycle; the bridge owns document persistence, and Codex continues to own native node conversations. This specification changes persistence ownership, not generation ownership.

## Settled constraints

- Local installation, one bridge data directory, one active editor per document. Assume reliable network requests; ordinary successful requests complete normally.
- Replace IndexedDB document storage outright. Do not copy, enumerate, import automatically, delete, or upgrade existing browser databases. A fresh backend directory starts empty regardless of old browser content.
- No offline storage, dual writes, synchronization, retries, recovery queues, backups, revision history, conflict handling, or new save-status UI. Retain existing save debouncing and explicit flushes.
- Keep existing authentication, path/asset validation, canonical schema checks, resource limits, and future-format refusal. These existing contracts remain required; do not add a generic defensive infrastructure layer.
- This request delivers a buildable spec only. Production code, current architecture documentation, generated artifacts, and existing unrelated working-tree changes remain untouched during specification.

## User stories

1. As a reader, I want to pair this browser with my local bridge, so that I can open the documents stored on this computer.
2. As a reader, I want an empty library on a new installation, so that I can start my first document.
3. As a reader, I want to create a document from a question, so that its question and answer remain available later.
4. As a reader, I want to import Markdown, a web article, or a PDF, so that its text and attachments remain available later.
5. As a reader, I want to author a document from source material, so that the resulting article is retained.
6. As a reader, I want selection Asks, whole-article follow-ups, and standalone questions retained, so that my branches survive reopening.
7. As a reader, I want completed answers to retain their conversation context, so that later questions branch from the correct answer.
8. As a reader, I want notes, edits, reactions, reading state, and canvas arrangement retained, so that reopening restores my workspace.
9. As a reader, I want pasted images and PDF selections retained, so that visual questions remain understandable.
10. As a reader, I want PDF conversion results retained, so that reopening preserves the readable article and its source.
11. As a reader, I want cancellation and retry to retain the current attempt's state, so that reopening never associates a failed answer with successful conversation history.
12. As a reader, I want to switch documents and reopen document links, so that I can return to the same saved work.
13. As a reader, I want to delete documents or individual nodes and undo deletion where supported, so that the retained content and attachments match my actions.
14. As a reader, I want portable exports and imports, so that I can intentionally move documents and their attachments.
15. As a reader, I want self-contained snapshots, so that shared copies open without my bridge or credentials.
16. As a reader, I want completed saves to survive page reloads and bridge restarts, so that restarting the application preserves my work.
17. As a reader, I want to pair a fresh browser profile or a browser with cleared site data, so that my saved library and follow-up context are available again.
18. As a reader, I want to open the same library from another allowed local page address after pairing, so that browser address changes do not hide my documents.
19. As a reader, I want to read and edit saved documents before signing into Codex or selecting a model, so that generation setup does not block my library.
20. As a reader, I want connection or pairing problems shown as setup problems, so that an unavailable library is not presented as an empty library.
21. As a reader, I want missing document links and unsupported newer documents reported clearly, so that the application does not silently replace my saved work.

## Implementation decisions

- **Store seam:** Keep the existing asynchronous document, asset, and staging methods. Add `HttpStore` in the browser and `FsStore` under the bridge; both satisfy the shared contract. Retain existing batch conveniences without introducing a separate batch protocol. Exact wire and disk contracts belong to [Storage contract](storage-contract.md).
- **Composition:** Replace the single `IdbStore` construction in `src/web/app.js` with a paired `HttpStore`. Continue injecting it into `DirectRabbitholeHost`, the document engine, ingestion, asset leasing, and portable projections. Do not move reducers, rendering, Ask orchestration, or streaming state into HTTP handlers.
- **Setup before documents:** Render existing shell/setup UI before loading summaries or resolving the initial document. Consume fragment pairing first. Only load the library once the bridge is authenticated and reachable; do not gate storage on model discovery or Codex readiness. Reuse existing setup/connection state rather than adding a second reconnect controller. A connection failure is not an empty list or a missing document.
- **Connection identity:** A store instance captures its bridge URL and token. After pairing or changing the connection, flush/dispose any current host against its original store before loading documents with a new instance. Do not let a deferred save resolve credentials dynamically and target a different backend. Keep the scope to the existing single-computer pairing flow.
- **Browser preferences:** Keep model choices, pairing settings, presentation preferences, and the last-opened document locator in their existing browser settings. They are not authoritative document data. A cleared last-opened locator falls back to the backend list. Missing locators use the existing missing-document behavior.
- **Save lifecycle:** Preserve full-document saves, debounce timing, serialized writes, completion binding, and flushes used by switching, exports, visibility changes, and disposal. Remove IndexedDB connection shutdown from `pagehide`. A resolved save means the backend write completed; there is no unload-delivery mechanism or guarantee for edits that never completed a save.
- **Assets:** Keep binary uploads and browser `Blob`/object-URL rendering, including PDF source bytes, crops, pasted attachments, import staging, deletion, and existing undo behavior. Fetch bytes through the authenticated store; do not embed bearer tokens in document asset URLs or add an unauthenticated static document directory.
- **Conversation ownership:** Preserve `backend_conversation` inside backend document records without changing `backend`, `sessionId`, or `scopeId`. Reopening on the same Codex history store retains create/fork semantics. Deleting documents does not delete native Codex history. Existing unavailable-history and scope-mismatch errors remain unchanged.
- **Formats:** Keep hole schema version 2, portable format version 1, canonical Markdown, and portable/snapshot projections. Backend records retain local extensions; portable files and snapshots continue stripping local conversation references and credentials. No storage-format migration or compatibility execution is introduced.
- **Simple failures:** HTTP operations check response status and surface existing error messages. Missing data follows the contract; other failures propagate. Do not add automatic retries, fallback stores, per-request circuit breakers, network fault injection, or a new error-state framework.
- **Removal:** Delete `IdbStore`, IndexedDB-specific lifecycle/test helpers and browser persistence-permission requests. Remove `fake-indexeddb` and its lockfile entry once its callers are replaced. Replace stale `FsStore` comments with the actual `FsStore`/`HttpStore` contract. Do not ship a storage selector or retain the old backend for tests.
- **Documentation at implementation:** Update `AGENTS.md`, architecture/data contracts, browser setup/deployment guidance, and the generated tour's persistence description. Regenerate committed `dist/` and generated docs after source changes. Keep the Node ≥18 and DOM-independent core requirements.

## Testing decisions and acceptance

- **Store/protocol seam:** Adapt `test/support/store-contract.mjs` and the existing IndexedDB contract coverage to run against a temporary-directory `FsStore` and an `HttpStore` connected to the real bridge. Cover schema refusal, summaries/order, save/load/delete, binary assets, staging/adoption/discard, and orphan cleanup through public store operations. Use existing raw-disk hooks only to inspect canonical records and seed a future-version fixture.
- **Native-history seam:** Extend `test/integration/bridge-http.test.mjs` to persist generated articles through the actual HTTP store, restart the bridge with the same data directory, load them again, and fork the saved answer through fake Codex. Verify the saved article and native history together; do not substitute a `saveHole` spy for persistence.
- **Browser seam:** Extend the existing browser harness with a real loopback document store in a disposable `RABBITHOLE_DIR`. Existing provider mocks may still simulate model output, but must pass storage routes to the real bridge; their generic `/bridge/**` success fallback must not swallow store requests. Replace `test/support/browser-store.mjs` with the new real-store fixture for existing ingestion/artifact tests.
- **Data-loss acceptance:** Through product UI, create a document with a generated branch and an attachment, wait for the persisted result, close its browser context, restart the bridge, and open a fresh context without cookies, localStorage, or IndexedDB. Pair again and verify library entries, body, attachment bytes, layout, and native follow-up context. Reopen from a second allowed local origin using the same bridge; the same hole ID must resolve.
- **Retained journeys:** Reuse setup, learning, PDF ingestion/conversion, node/document deletion and undo, reactions, portable round-trip, snapshot, and packaging scenarios. Change `src/web/test-seam.js` to inspect canonical documents through `store.loadHole()`; keep raw persisted-format inspection in the filesystem contract tests rather than adding a public debug endpoint. Update affected network assertions and performance measurements for authenticated loopback document/asset traffic.
- **Setup outcomes:** Exercise unpaired startup, pairing in another tab, bridge unavailable, no selected model, and Codex signed-out/missing using existing setup scenarios. Reading/editing works whenever storage is authenticated and available. Missing/future documents preserve existing explicit errors; rejected storage requests must not create replacement documents.
- **Verification:** Run affected contracts/integration/browser suites, `npm run check:types`, `npm run build`, `npm run build:docs`, `npm run check:dist`, `npm run check:docs`, and `npm test`. Add no internal mocking seam or standalone tests whose only assertion is that deleted code is absent. Existing unrelated failures must be reported separately from migration failures.

## Out of scope

Old IndexedDB data migration or recovery; browser database cleanup; compatibility adapters; backend selection UI; remote/cloud hosting; multi-user accounts; cross-device native-history portability; simultaneous editing or conflict detection; pagination/search redesign; offline mode; local caches; service-worker persistence; retries/outboxes; save indicators; backup/restore or version history; fsync/power-loss recovery; unload-delivery guarantees; document execution on the server; generation surviving page closure; native Codex history migration or deletion; new provider support; implementation or deployment in this spec-writing turn.

## Delivery

This local specification and its storage contract carry `ready-for-agent` status. No project issue-tracker workflow is configured in the inspected repository. Use `/setup-engineering-workflows` if tracker publication is later wanted; tracker setup is not a prerequisite to implementing this local spec.
