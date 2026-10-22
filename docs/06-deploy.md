# Deploy

The browser app is static; documents and attachments live on disk behind the local
bridge. Serving the app does not start the bridge: live document use and Codex
generation require a running bridge on the browser
user's computer. A bridge on a remote site server cannot reach a visitor's CLI.

Build `web/dist/` with `npm run build`; `npm run build:publish` produces the site
plus public assets in `publish/`. Serve complete output with an entry-page fallback
and JavaScript MIME types for `.js`/`.mjs`. Revalidate mutable assets; hashed chunks
may be cached. NGINX needs equivalent policy because it does not read `_headers`.

Stage assets before switching entry HTML, and retain older hashed chunks while old
pages remain open. A browser build and a bridge update must deploy together when
the generation or storage contract changes. This release replaces IndexedDB
document storage without migrating old browser data.
Wait for active answers, then restart the bridge to load backend source changes.
Ordinary restarts retain pairing; `--new-token` requires browsers to pair again.

Codex inherits its normal provider, credentials and search configuration. The bridge
overlays execution isolation without editing user files, with
[ego-browser](deploy/codex-ego-browser.md) as its sole skill exception. Restart Bridge
in Model settings replaces the HTTP-serving bridge process, loading updated bridge
source and Codex configuration. It retains pairing and refuses active generation.
The CLI launcher keeps foreground and service-manager ownership across restarts.
Claude Code and OpenCode execution remain TODOs.

Background services need explicit CLI paths, provider credential variables and
network/proxy environment. They do not inherit terminal exports. Exclude loopback
from proxies. Verify an actual answer from the managed bridge: ping and model
listing alone do not prove generation or search access.

Pairing links/logs contain private tokens; keep them out of static output and
shared logs. Browser-origin changes require pairing again; the same bridge data
directory exposes the same documents across allowed origins. Documents live under
`documents/` and import assets under `staging/` in `RABBITHOLE_DIR` (default
`~/.rabbithole/`); keep that directory persistent across service restarts.
Native Codex history must remain reachable for saved generated articles to fork.

See the [local NGINX runbook](deploy/local-nginx.md) for this installation and
[generated commands](generated/commands.md) for executable checks.
