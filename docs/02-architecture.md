# Architecture

The browser host owns the active document graph; the local bridge owns document
persistence and native generation. `HttpStore` implements the shared store port
through authenticated `/bridge/store/` routes, backed by `FsStore` under the bridge
data directory. Browser preferences and pairing remain local to each origin.
All generation entry surfaces converge on semantic task input through
`/bridge/generate`. Backend, model and reasoning are explicit configuration.
The frontend never builds system messages or serializes native conversation history.

Codex is the implemented backend. Creates start persistent native sessions;
generated-article Asks fork their associated sessions. Imported articles have no
baseline: every Ask creates independently with the full readable body. Only a
successful current completion binds the resulting session to its answer node.
Unavailable or cross-backend history fails rather than being reconstructed.
Claude Code and OpenCode adapters are TODOs.

For Responses providers, the bridge privately forwards Codex HTTP requests and
shares the root `Session-Id` and `prompt_cache_key` across a fork tree. Native
thread identity and history remain independent. Codex ancestry metadata restores
this cache affinity after restart; the browser stores no additional identity.
Runtime endpoint overrides leave user configuration unchanged. Shared identity
permits cache reuse but cannot guarantee an upstream cache hit.

The shared kernel owns documents, anchors, tree relationships, asset ownership,
rendering and artifact projections. It remains independent of Node, the DOM and
backend execution. Reader and canvas are views of the same graph.

Live canvas transport is in-page and explicitly injected; only persistence crosses
the store HTTP interface. The public MCP host and HTTP canvas transport have been
removed. Codex's
bridge-owned Ego browser tool remains internal to backend execution.

Native histories and local node associations survive reopening. Portable files
and frozen snapshots exclude those associations. Frozen snapshots embed all
needed assets/runtimes; live document assets load from authenticated bridge fetches
and render through browser object URLs. Static runtimes load from the app's origin.

The bridge is the sole document store. Pairing precedes library loading, while
Codex login/model readiness gates generation only. Completed saves survive browser
storage clearing and bridge replacement. The application assumes reliable local
requests and one active editor per document; it has no offline document cache,
automatic migration, retry queue, conflict handling or backup system.

The CLI launcher owns bridge process lifetime. Restart Bridge replaces the
HTTP-serving process after acknowledgment and shutdown, loading source afresh.
Port, environment and pairing persist; ephemeral instance IDs let the browser
distinguish a replacement from the old process during reconnection.
