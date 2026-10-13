# Contributing to Rabbithole

Use Node 18+, ES modules and browser-native APIs. Read
[Architecture](docs/02-architecture.md) before changing ownership, and
[Data contracts](docs/compatibility.md) before changing formats.

```bash
npm ci
npm run build
node bin/rabbithole.js bridge --no-open
```

Serve `web/dist/` separately with an entry-page fallback. Use a disposable
`RABBITHOLE_DIR` for bridge pairing, and an isolated Codex home for fake backend
checks. Keep private credentials and histories out of fixtures and commits.

Prefer existing integration tests at public seams. The principal generation seam
is browser host → provider → loopback bridge → fake Codex app-server → persisted
article/history. Browser tests drive product actions through UI and inspect only
state/artifacts through the shipped test seam.

[Testing](docs/testing.md) owns test selection and
[generated commands](docs/generated/commands.md) owns command inventory.

Before handoff, run affected tiers and structural checks, rebuild committed
`dist/` output, and regenerate documentation. `web/dist/` and `publish/` are ignored
build output. Never hand-edit generated bundles or raise performance budgets only
to make a check pass.

Keep shared core independent of Node and UI. Native sessions belong to backends;
articles retain only completed local references. Frozen snapshots embed everything
needed to read offline and strip personal/session configuration.

[Deployment](docs/06-deploy.md) owns operational procedures.
