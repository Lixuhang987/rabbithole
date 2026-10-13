---
status: accepted
date: 2026-10-13
---

# Unified backend sessions — destructive implementation spec

## Problem Statement

Model setup exposes several provider paths and overlapping preferences, while article context follows different rules across those paths. Readers cannot rely on every question creating an independent branch from the document they are reading. The owner of this installation does not use the MCP answering workflow and wants it removed, together with direct endpoints and compatibility execution.

## Solution

Use one frontend request contract and one local bridge for all generation. Implement Codex native sessions now: every request creates a new session, and questions on generated articles fork their source conversation. Questions on imported Markdown or PDF articles start new sessions with the article body and current Ask. Keep model setup to backend, model, and reasoning effort. Defer Claude Code and OpenCode execution.

## User Stories

1. As a reader, I want one generation path, so that answering follows the same rules everywhere.
2. As a reader, I want only backend, model, and reasoning controls, so that model setup stays small.
3. As a reader, I want model discovery from my configured backend, so that choices reflect my local setup.
4. As a reader, I want Codex to use its local provider configuration, so that endpoint and authentication setup have one owner.
5. As a reader, I want bridge pairing separate from model preferences, so that connection setup remains understandable.
6. As a reader, I want a root explainer to create a session, so that later questions can inherit its conversation.
7. As a reader, I want source-document authoring to create a session, so that its resulting article can support forks.
8. As a reader, I want selection Asks to fork the source article, so that the answer inherits the correct history.
9. As a reader, I want whole-article follow-ups to use that same fork rule, so that context does not depend on selection.
10. As a reader, I want sibling questions to fork independently, so that one sibling's answer does not influence another.
11. As a reader, I want a question on a generated child to fork that child's conversation, so that deeper branches inherit its answer.
12. As a reader, I want each Ask on imported Markdown to start a new session, so that independent questions do not share hidden state.
13. As a reader, I want each Ask on an imported PDF article to start a new session, so that imports need no reusable baseline.
14. As a reader, I want imported-article Asks to include the complete readable body, so that a fresh session can understand the document.
15. As a reader, I want my current question, selection, lens, and preset instruction included, so that the answer addresses my current intent.
16. As a reader, I want images and PDF-region attachments preserved, so that visual questions remain meaningful.
17. As a reader, I want an imported article's generated answer to own its session, so that follow-ups on that answer can fork normally.
18. As a reader, I want PDF transcription to use the selected model, so that there is no separate transcription configuration.
19. As a reader, I want missing vision support reported, so that I can choose an appropriate model.
20. As a reader, I want forks to apply the current model and reasoning settings, so that changing settings affects later requests.
21. As a reader, I want cross-backend history to be unavailable, so that switching backends never silently converts my conversation.
22. As a reader, I want unavailable history reported explicitly, so that context is never reconstructed without my knowledge.
23. As a reader, I want completed sessions retained locally, so that reopening preserves my article branches.
24. As a reader, I want exports and snapshots to exclude local session references, so that shared documents remain portable.
25. As a reader, I want only successfully completed answers associated with sessions, so that partial or failed output cannot become branch history.
26. As a reader, I want cancellation and deletion to stop the current answer, so that late output cannot attach to the wrong article.
27. As a reader, I want retries to use a new session or fresh source fork, so that failed answers do not contaminate history.
28. As the installation owner, I want MCP answering, direct endpoints, and compatibility paths deleted, so that unused execution paths no longer complicate the product.

## Implementation Decisions

- **Destructive scope:** Remove Rabbithole's public MCP server, CLI entry points, external-agent answering loop, live MCP-host transport, and their unused runtime support. Remove direct OpenRouter, Ollama, and custom endpoint generation, generic chat-completions compatibility, transcript serialization, baseline injection/recovery, and settings migrations. Do not keep aliases, compatibility endpoints, or migration branches.
- **Preserved boundary:** Keep the shared document engine, rendering, browser persistence, article/asset ingestion, portable artifacts, snapshots, and needed Node helpers. Removing the public MCP workflow does not remove Codex's configured tools or the bridge-owned browser tool and its dependencies.
- **Backend scope:** Only Codex execution is implemented and offered as usable. The bridge dispatches by an explicit backend field; model identifiers no longer double as backend routing. Unsupported backends fail clearly. Future adapters must implement native create/fork semantics.
- **Unified request:** One generation endpoint accepts backend, model, reasoning, optional sourceSession, and input. Input describes the task and its data: root explanation, document authoring, article Ask, or PDF transcription. The frontend sends semantic input, never system messages or a serialized conversation transcript.
- **Lifecycle rule:** A missing sourceSession creates a new native session; a present sourceSession forks it. Each request owns its resulting session, even when requests share one Codex app-server process. Never append an Ask to its source session.
- **Native reference:** A sourceSession identifies its backend, native session, and local history scope. Store successful article associations in one backend-neutral local extension. History-scope mismatch, missing history, and backend mismatch are explicit failures before generation; they do not trigger reconstruction or alternate execution.
- **Generated articles:** Root explanation and document authoring create persistent Codex sessions. Selection and whole-article Asks fork their source node conversation. Siblings fork the same source independently; descendants fork the conversation that generated their immediate parent.
- **Imported articles:** Every Ask on an imported Markdown or PDF article creates a session with the complete readable body, current question, selection, lens/preset instruction, and attachments. Do not associate a baseline with the imported source. Bind the resulting session to the generated answer. An unconverted PDF retains the existing conversion prerequisite for readable article context.
- **Fork input:** Submit the current Ask and its selection, lens/preset instruction, visual source needed to interpret the selection, and attachments. Do not resend parent bodies, ancestor summaries, or prior turns already present in native history.
- **Instruction ownership:** The bridge selects shared product prompt definitions by task and applies product instructions through the Codex adapter. Task-specific input formatting is permitted; a generic caller-supplied system/transcript compatibility layer is not.
- **Settings:** Retain backend, model, and reasoning effort. Remove provider presets, direct endpoint credentials/configuration, independent transcription models, and per-backend preference snapshots. Pairing connection settings and unrelated presentation or import preferences remain separate. Discover model, reasoning, and vision capabilities through the bridge.
- **PDF transcription:** Use the selected model and the same request/event contract. Each transcription request creates a session; page batches do not define one reusable article conversation. The imported PDF remains a fresh-session source for subsequent Asks. Preserve conversion progress, cancellation, and asset ownership.
- **Unified events:** Emit typed text, progress/search, completion-session, and error events through one streaming protocol. Preserve title handling and exact article text. A successful terminal completion carries the resulting session separately from Markdown; EOF alone is not success.
- **Binding and retries:** The host owns the target node and attempt identity. Persist answer content and its completed association together only for the current successful attempt. Failed, cancelled, truncated, deleted, or superseded attempts never bind sessions. Explicit retries create anew or fork the original source again.
- **Local persistence:** Persist native histories and node associations across reopening and bridge restarts. Exclude local associations from portable imports/exports and snapshots without mutating live state. Deleting an article does not automatically delete native history. No legacy-reference or settings migration is added.
- **Execution controls:** Retain bridge pairing, loopback/authentication/origin gates, current Codex configuration ownership, supported tool integration, request cancellation, and execution isolation. Apply current model, reasoning, product instructions, and a valid request working directory to creates and forks.
- **Delivery:** Remove obsolete commands, tests, fixtures, documentation, and package surface belonging solely to deleted usage. Update surviving contracts and operational documentation, and regenerate committed browser/documentation artifacts required by the repository.

## Testing Decisions

- Prefer the existing browser-host → provider → real loopback bridge → fake Codex app-server seam. Exercise public host commands and inspect persisted articles plus external Codex history to prove complete behavior; do not test private caches, incidental ordering, or generated identifier values.
- Adapt the existing article-generation, independent sibling/descendant fork, reopening, and bridge-restart integration scenarios to the unified contract. Adapt imported-article coverage to independent creates followed by a fork from a generated answer. Inspect submitted input to verify complete imported content and incremental fork input.
- Reuse existing streaming-lifecycle coverage for arbitrary fragmentation, titles, terminal completion, cancellation, retry, and late output. Require a completed session before article binding. Extend current operational failure scenarios for unavailable native history and backend mismatch without introducing a standalone suite whose purpose is proving removed features are gone.
- Reuse existing portable artifact, snapshot, PDF conversion, setup, browser journey, and installed-package seams. Update setup to the minimal settings and current-model vision behavior; preserve the observable document and asset outcomes of retained workflows.
- Update existing tests first. The cumulative budget for this spec is at most four new independently executed cases; planned additions are zero unless existing scenarios cannot observe a required outcome. Remove tests solely for deleted features and retain meaningful coverage for surviving boundaries.
- Run affected deterministic integration/contracts/browser checks, required structural checks, and the default suite after rebuilding. Installed-Codex acceptance remains an opt-in check; fake protocol support alone is not evidence that a local binary successfully persists and forks history.

## Out of Scope

- Claude Code execution and native session implementation — TODO.
- OpenCode execution — TODO; use the same bridge contract when added.
- Backward compatibility, old settings/reference migration, generic model endpoints, public MCP usage, and automatic history reconstruction.
- Cross-backend conversation conversion, cross-device history migration, session browsing UI, and automatic history deletion.
- Synchronizing later article/note edits into existing native history, turn checkpoints, or redesigning the reading canvas and Ask placement.
- Publishing this spec to an issue tracker or implementing production code as part of this specification request.

## Further Notes

All product decisions in this spec were confirmed in the conversation. Implementation and verification are tracked in [the local execution plan](../plans/backend-session-unification.md). It replaces the previous Codex-only opt-in design's baseline and compatibility behavior. Its main causal constraint is native history ownership: a unified frontend format cannot make history portable across backends, so unavailable history is an explicit boundary rather than a fallback.
