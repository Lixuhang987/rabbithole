# Local NGINX and Codex bridge

This runbook describes the macOS deployment configured on 2026-10-07. Paths and launchd labels are local installation details, not package defaults. For deployment boundaries, see [Deploy](../06-deploy.md).

## Two services must be running

| Service | Current configuration | Responsibility |
| --- | --- | --- |
| NGINX | `/opt/homebrew/etc/nginx/rabbithole.conf`; launchd `local.rabbithole.nginx` | Serve `http://localhost:3000/` from `/Users/mu9/proj/rabbithole/web/dist` |
| Bridge | `~/Library/LaunchAgents/local.rabbithole.bridge.plist`; launchd `local.rabbithole.bridge` | Run this checkout's `bin/rabbithole.js` with `bridge --no-open` on `127.0.0.1:41414` |

**The bridge must stay running to use Codex and its web search.** NGINX cannot start it. Both launch agents currently start at user login and restart their processes if they exit. The bridge service's PATH includes Homebrew and `~/.local/bin` so it can find the installed CLIs.

**A launchd service does not inherit terminal proxy variables.** On this machine, direct OpenAI connections time out; the bridge launch agent therefore explicitly sets `http_proxy` and `https_proxy` to `http://127.0.0.1:7897`, and `all_proxy` to `socks5://127.0.0.1:7897`. `NO_PROXY` and `no_proxy` exclude `localhost,127.0.0.1,::1`. Keep that local proxy running; if its port changes, update the plist. Account/model discovery succeeding does not prove that generation can reach OpenAI.

Codex's configured third-party provider also reads its credential through `env_key`. The bridge launch agent must supply that variable; a key available only in the terminal leaves model discovery working while generation fails. This installation supplies it through `EnvironmentVariables`, and the plist is restricted to mode `0600`. Keep that private plist out of version control and shared logs.

After changing the launch agent's environment, unload and reload it; `kickstart` alone does not reread an edited plist. This interrupts active answers:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/local.rabbithole.bridge.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/local.rabbithole.bridge.plist
```

## Update this installation

Use the canonical checkout; wait for active answers to finish before restarting the bridge. The NGINX root is the build directory itself, so avoid building while people are using this local page, and refresh existing tabs afterward. `localhost:3000` and `127.0.0.1:3000` have separate pairing/preferences; pair each origin to the same bridge to open the same disk-backed documents. Preserve the bridge data directory across replacements. Old browser documents are not migrated.

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

After bridge/backend source changes, use Restart Bridge in Model settings to
reload the HTTP-serving process. When updating the CLI launcher itself, or
upgrading a service started before process restart support, restart the service:

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
3. Choose a Codex model and reasoning, then confirm Ready. Web search follows Codex configuration.

The bridge reuses the local CLI's authentication. Codex uses its normal user configuration, respecting `CODEX_HOME` when supplied; providers that do not require OpenAI authentication work without OpenAI sign-in. Codex providers and Web Search are inherited, while the bridge overrides MCP, skills, goals, multi-agent and sandbox permissions, with [ego-browser as the sole skill exception](codex-ego-browser.md). If a provider requires account login, run `codex login`, then retry. Do not enter an account password or provider API key in Pairing link.

Ordinary restarts retain `~/.rabbithole/bridge-token`. Changing it with `--new-token` invalidates existing browser pairings. The private service log is `~/.rabbithole/bridge-launchd.log`; it contains the pairing token, so keep its permissions restricted and redact tokens before sharing logs.

## Verify after updating

```bash
launchctl print "gui/$(id -u)/local.rabbithole.nginx"
launchctl print "gui/$(id -u)/local.rabbithole.bridge"
curl --noproxy '*' -I http://localhost:3000/
curl --noproxy '*' -fsS http://127.0.0.1:41414/bridge/ping
```

Both services should be running and HTTP checks should return 200. Compare the served HTML and referenced scripts/styles with `web/dist/`, including lazy-loaded chunks; Model settings lives in a lazy chunk, not the entry `app.js`. In the browser, confirm Connected, Codex Ready, and the selected model. Ask a question requiring current information, observe search progress, and check the resulting source link to verify real search access. Asset checks, model listing, and offline mocks alone do not prove that the real search backend works.

| Symptom | Check |
| --- | --- |
| Page opens, but says Start bridge | Bridge service state and port 41414; NGINX availability does not imply bridge availability |
| Bridge runs, but asks for Pairing link | Pair this browser origin/profile; another browser's pairing does not carry over |
| Agent is signed out | The selected local CLI's login; pairing does not sign into Codex |
| UI updated, but backend behavior is old | Bridge must run this checkout and be restarted after backend changes |
| Low reasoning still stays Thinking for minutes | Check the bridge/Codex process's proxy environment and local proxy availability; system or terminal proxy settings alone do not prove launchd inherited them |
| Address already in use | Another bridge owns port 41414; use the managed service instead of launching a duplicate |
| Search fails while normal answers work | Retry, check Codex/backend access, or disable search in Codex configuration; preserve the separate search error |
