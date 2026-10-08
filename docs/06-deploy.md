# Deploy

The hosted web app is a static build. It needs no application server and holds no user documents or provider credentials. An optional fetch relay exists only for public sources that cannot be fetched directly by a browser.

The local package is distributed with committed browser artifacts so a package runner can start the MCP server immediately. The shared kernel and local host execute directly from the published source.

Release verification separates building from deployment. Continuous integration builds and verifies the exact static bytes that the deployment workflow later publishes. A deployment therefore cannot quietly rebuild different output.

Self-hosters can serve the static web output from any host that supports a fallback to the application entry page. The local MCP host and subscription bridge remain separate processes on the user's machine.

## Static site and subscription bridge

**Deploying the page does not start or update the subscription bridge.** NGINX serves the browser build; Claude Code / Codex answers and native Codex web search require a running bridge on the browser user's computer. OpenRouter and custom endpoint requests do not require this bridge. A bridge running on a remote web server does not connect to a visitor's local CLI account.

Build `web/dist/` with `npm run build`, or use `npm run build:publish` for the site plus about/public assets in `publish/`. Serve the chosen complete output, with an entry-page fallback and JavaScript MIME types for `.js` and `.mjs`. Entry HTML and mutable assets must revalidate; content-hashed chunks may be cached. NGINX does not interpret the generated `_headers` and `_redirects` files: equivalent behavior belongs in its configuration.

For a separate production directory, stage the build before publishing, install referenced assets before switching the entry HTML, and keep older hashed chunks reachable while old pages remain open. Verify served bytes against that staged build. Reloading NGINX is necessary for configuration changes; changed static files alone do not require a process restart.

For subscription deployments, update the bridge source/package as well as the browser assets, wait for active answers to finish, and restart the bridge. A running Node process retains loaded modules, so reloading NGINX or rebuilding the UI cannot activate bridge changes. Keep the existing pairing token during ordinary updates; `--new-token` requires browsers to pair again.

The bridge requires an installed, signed-in CLI. It reuses CLI authentication. Codex inherits user configuration, including custom providers and Web Search, while the bridge overlays restrictions on MCP, skills, goals, multi-agent and sandbox permissions without changing user files. Use Restart Bridge in Model settings after editing CLI configuration; it reloads CLI backends without re-pairing and requires active answers to finish first. The pairing link authorizes the browser to reach the bridge; it is separate from the CLI account login. Pairing links and bridge logs containing tokens must not be published with static assets.

Background services also need explicit CLI paths and network/proxy environment. A launchd service does not inherit a terminal's exports; in networks requiring a proxy, login and cached model discovery can succeed while generation stalls on a direct connection. Verify an actual short answer from the managed bridge, not only a ping or model list. Exclude loopback from proxying, and reload the service definition after changing its environment.

Deployment acceptance has two independent checks: the page must serve the intended bundle, and the browser must connect to the intended bridge with its selected agent showing Ready. A successful `/bridge/ping` only proves that the process is reachable; it does not prove pairing, account access, or search-backend availability. A real search answer with a working source link is a separate end-to-end check.

See the [local NGINX and bridge runbook](deploy/local-nginx.md) for this checkout's service paths, restart commands, pairing, and troubleshooting.

Generated command, environment, network-policy, and module maps carry the exact operational details; this guide records the deployment model that should remain true as those details evolve.
