# Backend storage implementation plan

Approved scope: [spec](spec.md) and [storage contract](storage-contract.md).
Baseline: `b7cfb3c`; the owner authorized proceeding with existing baseline failures.

## Use cases and contracts

- Pair/reopen: existing shell and bridge connection → authenticated HttpStore → library → existing document host/UI. A fresh browser reads the same hole, attachments and node conversation references.
- Create/edit/import/delete: existing host/ingestion commands → store port → bridge HTTP handlers → FsStore → canonical hole JSON and binary files. Reads use schema version 2; portable format remains version 1.
- Generate/restart/follow-up: existing provider → bridge → fake Codex; successful current article save retains its session reference. A replacement bridge with the same data root loads and forks it.
- Pairing/model setup: existing connection/setup controller exposes storage availability independently of Codex/model readiness. No retry queue, local document cache or data migration.

## Test-first selection and tasks

1. Replace `test/contracts/indexeddb-store.test.mjs` with `backend-store.test.mjs`, retaining store-contract and host behavior; exercise FsStore and real HTTP storage. Run red before adding implementation. Existing case replacement: no new independently executed case.
2. Implement filesystem records/assets/staging, HTTP handlers and HttpStore; update shared declarations. Pass storage contract, types and retained core tests.
3. Extend `test/integration/bridge-http.test.mjs` to save/reload through HTTP and fork after restart. Update `browser-store.mjs` fixtures and retain native history coverage.
4. Add one real-browser/process persistence journey in `test/integration/backend-persistence.test.mjs` (existing tests cannot combine fresh browser and native process replacement). Adapt browser harness/provider mocks to real storage. Update app composition, setup ordering and store identity; remove IndexedDB lifecycle/test-seam dependencies. Extend existing `web-app-learning` and `web-app-setup` journeys for fresh contexts, alternate origin and Codex-independent reading.
5. Remove IndexedDB dependency and obsolete checks, update architecture/contracts/deployment/tour documentation; rebuild bundles and generated docs. Run affected suites, structural checks, and full suite; compare against baseline failures.
6. Commit implementation, review against `b7cfb3c` using code-review's separate Standards and Spec reviewers, fix actionable findings and commit corrections.

Cumulative new independently executed cases: 1 (`backend-persistence.test.mjs`, fresh browser/process flow); maximum 4. Reuse existing test entries and preserve their behavioral assertions. Skip standalone absence tests for deleted IndexedDB code. Raw-disk inspection stays in store-contract hooks; UI actions stay in product controls.

## Delivery status

Implemented on `codex/backend-document-storage` in the isolated worktree. Implementation commit: `ba68988`; follow-up fixes preserve connection ownership and stabilize existing browser assertions. See [verification](verification.md) for results and the separate review reports. The original spec's specification-only wording records its earlier writing phase; the subsequent implement request authorized production changes.
