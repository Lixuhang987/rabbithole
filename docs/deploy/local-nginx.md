# Local NGINX and subscription bridge

This runbook describes the macOS deployment configured on 2026-10-07. Paths and launchd labels are local installation details, not package defaults. For deployment boundaries, see [Deploy](../06-deploy.md).

## Two services must be running

| Service | Current configuration | Responsibility |
| --- | --- | --- |
| NGINX | `/opt/homebrew/etc/nginx/rabbithole.conf`; launchd `local.rabbithole.nginx` | Serve `http://localhost:3000/` from `/Users/mu9/proj/rabbithole/web/dist` |
| Bridge | `~/Library/LaunchAgents/local.rabbithole.bridge.plist`; launchd `local.rabbithole.bridge` | Run this checkout's `bin/rabbithole.js` with `bridge --no-open` on `127.0.0.1:41414` |

**The bridge must stay running to use Claude Code, Codex, or Codex Web search.** NGINX cannot start it. Both launch agents currently start at user login and restart their processes if they exit. The bridge service's PATH includes Homebrew and `~/.local/bin` so it can find the installed CLIs.

**A launchd service does not inherit terminal proxy variables.** On this machine, direct OpenAI connections time out; the bridge launch agent therefore explicitly sets `http_proxy` and `https_proxy` to `http://127.0.0.1:7897`, and `all_proxy` to `socks5://127.0.0.1:7897`. `NO_PROXY` and `no_proxy` exclude `localhost,127.0.0.1,::1`. Keep that local proxy running; if its port changes, update the plist. Account/model discovery succeeding does not prove that generation can reach OpenAI.

After changing the launch agent's environment, unload and reload it; `kickstart` alone does not reread an edited plist. This interrupts active answers:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/local.rabbithole.bridge.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/local.rabbithole.bridge.plist
```

NGINX also forwards `/axon/` to the local service on port 8090, with streaming buffering disabled. That custom endpoint route is independent of the subscription bridge and its native search tools.

## Update this installation

Use the canonical checkout; wait for active answers to finish before restarting the bridge. The NGINX root is the build directory itself, so avoid building while people are using this local page, and refresh existing tabs afterward. Keep the chosen hostname and port: browser documents and pairing settings are scoped to the origin; `localhost:3000` and `127.0.0.1:3000` have separate storage.

```bash
cd /Users/mu9/proj/rabbithole
npm run build
npm run check:dist
nginx -t -c /opt/homebrew/etc/nginx/rabbithole.conf
```

The build updates the files served by NGINX. If its configuration changed, reload it only after the configuration check succeeds:

```bash
nginx -s reload -c /opt/homebrew/etc/nginx/rabbithole.conf
```

When bridge/backend source changed, restart the existing service to load it:

```bash
launchctl kickstart -k "gui/$(id -u)/local.rabbithole.bridge"
```

Do not also start a foreground bridge on port 41414 while this service runs. For a manual installation without that launch agent, the source-checkout command is:

```bash
node bin/rabbithole.js bridge --no-open
```

That foreground process must remain open. `npx @shlokkhemani/rabbithole bridge` runs the published package, which may differ from the modified checkout being served here.

## Connect the browser and account

1. Open the same local origin used for your existing documents, then Model settings.
2. Paste the bridge's pairing link into Pairing link and click Connect. The field also accepts just the token; copy this installation's token with `cat ~/.rabbithole/bridge-token | pbcopy`.
3. Select Codex or Claude Code and confirm Ready. Complete setup if prompted. For Codex answers, Web search is on by default.

The bridge reuses the local CLI's login. Codex uses its normal user configuration and login, respecting `CODEX_HOME` when supplied; Claude Code obtains its existing login through the installed CLI. Codex providers and Web Search are inherited, while the bridge overrides MCP, skills, goals, multi-agent and sandbox permissions. If an agent is signed out, run `codex login` or `claude /login`, then retry. Do not enter an account password or OpenAI API key in Pairing link.

Ordinary restarts retain `~/.rabbithole/bridge-token`. Changing it with `--new-token` invalidates existing browser pairings. The private service log is `~/.rabbithole/bridge-launchd.log`; it contains the pairing token, so keep its permissions restricted and redact tokens before sharing logs.

## Verify after updating

```bash
launchctl print "gui/$(id -u)/local.rabbithole.nginx"
launchctl print "gui/$(id -u)/local.rabbithole.bridge"
curl --noproxy '*' -I http://localhost:3000/
curl --noproxy '*' -fsS http://127.0.0.1:41414/bridge/ping
```

Both services should be running and HTTP checks should return 200. Compare the served HTML and referenced scripts/styles with `web/dist/`, including lazy-loaded chunks; the Web search control lives in the settings chunk, not the entry `app.js`. In the browser, confirm Connected, Codex Ready, and the Web search switch. Ask a question requiring current information, observe search progress, and check the resulting source link to verify real search access. Asset checks, model listing, and offline mocks alone do not prove that the real search backend works.

| Symptom | Check |
| --- | --- |
| Page opens, but says Start bridge | Bridge service state and port 41414; NGINX availability does not imply bridge availability |
| Bridge runs, but asks for Pairing link | Pair this browser origin/profile; another browser's pairing does not carry over |
| Agent is signed out | The selected local CLI's login; pairing does not sign into Claude or OpenAI |
| UI updated, but backend behavior is old | Bridge must run this checkout and be restarted after backend changes |
| Low reasoning still stays Thinking for minutes | Check the bridge/Codex process's proxy environment and local proxy availability; system or terminal proxy settings alone do not prove launchd inherited them |
| Address already in use | Another bridge owns port 41414; use the managed service instead of launching a duplicate |
| Search fails while normal answers work | Retry, check Codex/backend access, or disable search in Codex configuration; preserve the separate search error |
