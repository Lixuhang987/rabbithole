# Backend document persistence verification

Date: 2026-10-22. Baseline: `b7cfb3c01cc463673f38e72788ac41fb54d3ec33`. Branch: `codex/backend-document-storage`.

## Delivered behavior

Live documents now use the existing asynchronous store port through browser `HttpStore`, authenticated bridge routes and backend `FsStore`. Canonical JSON and binary attachments live in `<RABBITHOLE_DIR>/documents/` (default `~/.rabbithole/documents/`); PDF import staging lives in the sibling `staging/` directory. Native Codex history retains its existing owner. IndexedDB document storage and fake-indexeddb were removed. Browser pairing and presentation preferences remain browser settings.

The migration is destructive: no browser data copying or cleanup, compatibility adapter, retries, offline cache, save-status UI, revisions or conflict system was added. Existing auth, schema, path and asset limits remain enforced. Portable documents and snapshots strip local conversation references.

## Verification

- Baseline full suite: 75 passed, 6 failed, 0 skipped (`/tmp/rabbithole-backend-document-storage-baseline.log`). The user explicitly authorized continuing with those failures.
- Latest full suite: 76 passed, 6 failed, 0 skipped (`/tmp/rabbithole-backend-document-storage-complete.log`). Five failures overlap the baseline. The sixth was an existing note geometry assertion reading the overlay before its scheduled reposition; after adding an animation-frame wait, the entire notes journey passed independently (1 passed, 0 failed; `/tmp/rabbithole-note-final2.log`). A deferred initial-focus wait also preserves the original Backspace assertion. The full suite was not repeated after these final waits.
- After the final app source/build, backend-store, backend-persistence, bridge-http and web-app-setup passed together: 4 passed, 0 failed (`/tmp/rabbithole-backend-final-targeted.log`).
- `npm run build`, `npm run build:docs`, `npm run check:types`, `npm run check:dist`, `npm run check:docs` and `git diff --check` passed. Committed shared bundles were regenerated and remained byte-identical; the web host bundle is generated in ignored `web/dist/`.
- Retained artifact, portability/security, generation, image, Mermaid, selection and learning coverage passed in the full suite. Exactly one new independently executed case was added: backend-persistence.

The new browser journey generates a document and pasted image through the UI, waits for backend persistence, closes the browser context, restarts the bridge, pairs a fresh context at another allowed local origin, checks node content/layout/references and attachment bytes, then successfully forks the saved native answer. Missing document links show an explicit error without creating data. Two real backends also verify that a delayed import completion cannot mount under a new pairing and Undo restores only the original backend.

## Remaining baseline failures

| Check | Observed failure |
| --- | --- |
| `check:purity` | Requires exactly one agent turn deadline; the baseline defines none. |
| `test/integration/pdf-precision.test.mjs` | Click waits on the disabled explain lens. |
| `test/integration/web-ingestion.test.mjs` | Same disabled explain lens click timeout. |
| `test/e2e/web-app-sharing.test.mjs` | Baseline first stopped at settings width; later runs reach an unchanged combobox aria assertion expecting only `bridge-model-label`, while the UI includes `bridge-model-value`. |
| `test/packaging/install-smoke.test.mjs` | Tarball install fails with npm ETARGET for the existing `dompurify@^3.4.11` dependency. |

The sixth baseline failure, web-app-setup, now passes after observing the restart button's busy/completed states instead of a transient starting surface. Unrelated baseline implementation/dependency problems were left outside this migration.

## Standards

Independent Standards review and follow-up: 0 remaining findings. Creation/import/Undo retain their original store instance; navigation and deletion reuse the existing transition queue. Tests inspect actual persisted HTTP results and retain their behavioral assertions.

## Spec

Independent Spec review and follow-up: 0 remaining findings. Three connection ownership issues were found and closed: deferred create/import/navigation mounting against a newly paired backend; Undo writing into a new backend; and an old library response replacing the new backend's rail. Store capture, queued mount checks and a post-read identity check resolve them without adding a new state framework. The reviewers confirmed the original reproductions and two-bridge regression now pass.

Findings remaining: Standards 0; Spec 0.
