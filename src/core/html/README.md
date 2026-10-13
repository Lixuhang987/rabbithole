# Shared HTML

Shell, icons and page assembly are host-independent. Live browser UI loads from
its static origin; frozen snapshots inline the shell, authored stylesheet,
sanitizer and frozen client. Mermaid/PDF runtimes are embedded only when needed.

All product-owned icons live in `icons.js`, with role mapping in
`icon-selection.js` and generated Ionicons data in `ionicons5.generated.js`.
After UI/style/icon changes, rebuild and verify committed `dist/` artifacts.

Hydration carries Markdown, not rendered HTML. The shared renderer sanitizes it;
hosts supply `asset:` resolution. In-page transport is explicitly injected by the
browser host. Frozen runtime excludes generation, settings, store and export code.

The browser's HTTPS egress supports source ingestion and loopback HTTP supports
the paired bridge. Fetch-proxy SSRF policy remains a separate narrow allowlist.
