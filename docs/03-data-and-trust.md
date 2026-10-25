# Data and trust

Documents and assets live in the paired bridge's data directory. The browser holds
the active graph and accesses persistence through authenticated store requests.
Native generation history lives in Codex's
configured local home. A session reference is machine-local and cannot make
history portable across backends or devices.

Markdown is canonical; rendered HTML is derived and sanitized. One asset reference
view governs deletion, undo and exports. Imported HTML remains inert.

The browser pairs with the loopback bridge using a bearer token. Loopback binding,
authentication and origin gates are separate controls. Codex owns model-provider
credentials; the browser stores only its pairing configuration and model choices.
Neither configuration nor native session references enters portable documents.

The local `backend_conversation` extension identifies backend, native session and
history scope. A successful terminal completion is required before binding, and
host attempt identity prevents cancelled, deleted or superseded runs from binding.
EOF alone is not completion. Retries create anew or fork the original source.

Current document schemas are validated; future versions fail clearly. Settings and
session references have no compatibility migration. Snapshot projection retains
note and canvas state while clearing personal state.

[Data contracts](compatibility.md) owns stored/portable boundaries; generated
[network policy](generated/csp.md) separates browser egress from relay SSRF limits.
