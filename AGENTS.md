# Notes for agents developing Rabbithole

Rabbithole is a browser document canvas with a paired local Codex bridge. The
browser owns documents and IndexedDB; Codex owns native answer history. Read
[Architecture](docs/02-architecture.md) before changing those boundaries and
[Data contracts](docs/compatibility.md) before changing stored or portable data.

- `src/core/`: host-independent document engine, rendering, artifacts, contracts.
- `src/ui/`: browser runtime shared by live documents and frozen snapshots.
- `src/web/`: browser host, native bridge provider, ingestion and IndexedDB.
- `src/node/bridge/`: authenticated loopback transport and native Codex sessions.
- `src/node/shared/`: Node helpers needed by the bridge and artifact tools.
- `dist/`: committed browser bundles; regenerate after UI changes.

## Development

```bash
npm install
npm run build
node bin/rabbithole.js bridge --no-open
npm test
```

Serve `web/dist/` separately. Bridge pairing data lives under `~/.rabbithole/`
(`RABBITHOLE_DIR` overrides); Codex retains native history in its configured home.

## Conventions

- Spell **Rabbithole** as one word. Use ES modules and support Node ≥18.
- Keep frozen snapshots self-contained and the shared core independent of Node
  and the DOM.
- All generation uses the semantic `/bridge/generate` contract. Creates and
  forks each own a new session; only completed current attempts bind articles.
- Codex is the implemented backend. Claude Code and OpenCode are TODOs.
- This architecture removes compatibility execution and settings/reference
  migrations. Refuse future document formats clearly; never truncate them.
- Keep credentials, pairing tokens and native session references out of portable
  documents. Application diagnostics use stderr; CLI stdout carries its banner.
- Put product-owned SVG icons/brand marks in `src/core/html/icons.js` and render
  them with `iconSvg()`. Structural/user-authored SVG stays at its trust boundary.

[Testing](docs/testing.md) owns verification guidance. Regenerate `dist/` and
[generated docs](docs/generated/module-map.md) with source changes.
