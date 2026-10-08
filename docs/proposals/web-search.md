---
status: shipped
date: 2026-10-07
---

# Codex native web search

Rabbithole's Codex subscription provider inherits Web Search configuration from the user's Codex environment, including `CODEX_HOME` when supplied. Search mode and the choice between standalone and hosted search belong to Codex configuration; Rabbithole does not override them for answers, source authoring, or PDF transcription. Model settings explain this ownership instead of offering a search switch.

## Execution and authentication ownership

The bridge launches the installed Codex app-server against the user's configuration and authentication. It overlays execution restrictions via CLI arguments without rewriting user files: skills, plugins, goals, multi-agent and orchestrator capabilities are disabled, with read-only sandboxing and no approval prompts. Registered MCP servers are discovered through the native CLI and disabled individually, because an empty table would merge with inherited servers rather than clear them. A failed MCP configuration read prevents startup.

Each generation uses an ephemeral thread in a temporary directory. Search remains a native Codex capability and does not require enabling sandbox network access. After changing process-level user configuration, use Restart Bridge in Model settings to reload CLI backends and their catalog. The paired listener and token stay in place; active answers must finish before a restart.

Standalone search uses the provider's native search endpoint and authentication. Hosted search is selected by Codex when applicable. The citation adapter currently resolves native reference IDs from search result DTOs; hosted events without those DTOs may leave references unavailable. Inheriting hosted configuration does not establish equivalent citation output. Real account and endpoint availability require separate live verification.

The MCP host still receives answers from its external agent, whose own tool configuration controls searching.

## Transport and document boundaries

App-server search items travel over authenticated bridge SSE as `rabbithole.search` events, then through the browser generation adapter as transient search progress. Search state can update pending reader and canvas surfaces, but does not enter the document reducer or persisted holes. Concurrent calls are tracked by call id, and completion, retry reset, and errors clear the live status. Cancellation suppresses late app-server output.

Agent commentary is excluded from answer text. Native reference citations are buffered across text fragments and resolved using search result DTOs. Only validated HTTP(S) URLs without embedded credentials become Markdown links. Unresolved references become an explicit source-unavailable label, rather than a guessed URL. Unknown result DTO fields are ignored.

Markdown is the durable source of citations, so ordinary document saving, portable exports, and frozen snapshots retain links without credentials, search-session ids, or opaque backend references. Sharing citations does not depend on personal node extensions.

Search failures surface a retryable provider error with guidance to retry or check their Codex configuration. Authentication failures retain the existing signed-out recovery flow. There is no silent fallback to another search provider.

## Verification boundaries

Bridge integration verifies native search lifecycle, cancellation, and durable Markdown citations. Browser setup verifies the configuration ownership hint. Installed-agent isolation uses a real Codex binary with offline provider/search endpoints to verify inherited search modes and restricted tools; it does not validate real backend access or hosted citation completeness.

Protocol research is retained in [local source evidence](./web-search-codex-evidence.md) and [official API evidence](./web-search-official-evidence.md).
