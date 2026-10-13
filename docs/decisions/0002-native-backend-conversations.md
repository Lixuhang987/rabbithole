---
status: accepted
date: 2026-10-13
---

# Native backend conversations own generation history

Rabbithole routes generation through a local bridge and uses native backend
sessions to preserve independent article branches. We remove MCP-driven
answering, direct model endpoints, transcript reconstruction, and compatibility
migrations so that there is one generation contract and one history owner.
Imported articles start a new session for each Ask; unavailable native history
and cross-backend branching fail explicitly rather than synthesizing history.
This trades endpoint flexibility and automatic recovery for a smaller execution
path with explicit context ownership.

Diagnostics continue to use standard error. The implementation scope and deferred
backends belong to [the session-unification spec](../proposals/backend-session-unification.md).

This decision supersedes clauses 1, 4, 7 and the two-host interpretation of
[0001](0001-load-bearing-constraints.md): live browser assets may load from their
origin, CLI stdout is a banner, settings have no migration, and only the browser
owns documents. Frozen snapshots remain self-contained.
