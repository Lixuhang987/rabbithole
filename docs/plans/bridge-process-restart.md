# Bridge process restart

## Contract

Restart Bridge must reload bridge source and Codex configuration in a fresh
HTTP-serving process. A small CLI launcher owns worker lifetime for both
foreground and service-manager launches. It starts the replacement only after
the old worker exits, retaining the selected port, environment and pairing token.
First-launch options `--new-token` and browser opening are not repeated.
Unexpected worker exits propagate to the launcher; shutdown never respawns.

The existing authenticated POST `/bridge/restart` refuses active generation.
It acknowledges the old instance identity before shutting down. New generation
is refused once restart is accepted. Shutdown closes Codex and HTTP/SSE clients.
The launcher then starts a fresh worker, which imports source from disk.
Embedded `createBridge` callers must supply the process restart callback.

Bridge state carries an ephemeral instance ID, never stored in documents.
The browser waits for a different instance with settled backend state using the
existing event-stream parser; a bounded timeout or authorization failure is
reported. Existing background connections reconnect normally.

## Flow

Button → restartBridge → POST /bridge/restart → response flush → worker shutdown
→ worker exit → launcher respawn → fresh imports → new state stream → ready UI.

## Verification and work

- Add one integration flow in `test/integration/bridge-process-restart.test.mjs`:
  launch a disposable checkout through the real CLI with fake Codex; generate a
  native root; edit that checkout's source; request restart through the browser
  client; verify a different PID and instance, changed source, same port/token,
  inherited native fork; repeat restart and verify graceful launcher shutdown.
- Reuse `bridge-failure-modes.test.mjs` for busy-generation refusal.
- Update `web-app-setup.test.mjs` and its external bridge stub to exercise
  disconnect, a new starting instance and eventual readiness before enabling
  the button. Cumulative new independently executed tests: 1.
- Implement launcher/worker lifetime, server acknowledgment and shutdown,
  then browser recovery. Update deployment guidance and generated docs.
- Run affected integration, browser setup, packaging, types, build and default
  checks. Work stays in the canonical checkout used by the local service so
  deployment can load the completed change.

## Verification

Process restart, native bridge integration, browser setup, types, build,
distribution and generated-doc checks pass. The local launchd service was
upgraded once; a subsequent authenticated restart replaced its worker, restored
Ready and retained pairing, with the cache-affinity proxy active.

Default suite: 75 passed, 6 failed. All six reproduce on pristine HEAD: the
removed-deadline purity assertion, PDF precision, web ingestion, note geometry,
sharing accessible-name assertion, and packaging dependency resolution
(`dompurify@^3.4.11` unavailable from the configured registry).
