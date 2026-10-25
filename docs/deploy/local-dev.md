# Local development and Codex bridge

This installation uses `npm run dev` for the frontend and the existing launchd
bridge service for persistence and Codex. For deployment boundaries, see
[Deploy](../06-deploy.md).

## Run the frontend

```bash
cd /Users/mu9/proj/rabbithole
npm run dev
```

Open `http://localhost:3000`. NGINX is no longer used. The development server binds
to loopback, builds into a temporary directory and reloads open pages after a
successful frontend build. Failed builds print errors and retain the previous
page. Stop it with Ctrl+C. Use `npm run dev -- --port 3001` to select another port.

Reloads replace page state, including unsent input; finish active answers before
editing frontend code. This is full page reload, not state-preserving module HMR.
Changes to the development server itself require restarting the command.
Production artifacts still come from `npm run build`.

Keep the existing origin: `localhost:3000` and `127.0.0.1:3000` have separate
pairing/preferences. Changing a port also changes the origin and needs pairing.
Pairing to the same bridge exposes the same disk-backed documents.

## Keep the bridge running

The launch agent `~/Library/LaunchAgents/local.rabbithole.bridge.plist` runs this
checkout's `bin/rabbithole.js` with `bridge --no-open` on `127.0.0.1:41414`. It starts at
login and restarts on exit. Do not launch a duplicate on the same port. Without
that managed service, run `node bin/rabbithole.js bridge --no-open` separately.

Backend edits still require Restart Bridge in Model settings after active answers
finish. CLI launcher updates require restarting the launch agent:

```bash
launchctl kickstart -k "gui/$(id -u)/local.rabbithole.bridge"
```

The service needs explicit PATH, proxy and provider credential variables; it does
not inherit terminal exports. This installation uses proxy ports 7897 and excludes
`localhost,127.0.0.1,::1` through `NO_PROXY` and `no_proxy`. Keep the local proxy
running. Codex's provider `env_key` must also be supplied by the private plist,
which should remain mode `0600`. Never commit or share it. After changing the
plist's environment, unload and reload it; kickstart does not reread it:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/local.rabbithole.bridge.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/local.rabbithole.bridge.plist
```

## Pair and verify

Open Model settings, paste the pairing link or token, and click Connect. For this
installation, copy the token with `cat ~/.rabbithole/bridge-token | pbcopy`.
Pairing is separate from Codex authentication; providers requiring login use
`codex login`. Codex inherits provider/search configuration subject to
[bridge isolation](codex-ego-browser.md).

Ordinary restarts retain pairing and disk documents under `~/.rabbithole/`.
`--new-token` invalidates pairings. Preserve that data directory and native Codex
history. The private log `~/.rabbithole/bridge-launchd.log` contains the pairing
token; redact it before sharing.

```bash
curl --noproxy '*' -I http://localhost:3000/
curl --noproxy '*' -fsS http://127.0.0.1:41414/bridge/ping
```

Confirm Connected and Codex Ready in the browser. An actual answer requiring
current information verifies backend/search connectivity; HTTP health and model
listing alone do not. If answers time out, check the managed bridge's proxy and
credential environment. If backend behavior is old, restart the bridge.
