# Rabbithole

An infinite canvas for learning. Open a document, ask at any point, and follow each answer into a new document.

[Open the web app](https://rabbithole.ing) · [Offline architecture tour](docs/tour.html)

## Quick start

Requires Node 18+, a browser, and an installed Codex CLI.

```bash
npx @shlokkhemani/rabbithole bridge
```

Open the private pairing link printed by the bridge. Choose a model and reasoning
in Model settings, then start with a question, URL, Markdown, PDF, or Rabbithole file.
Keep the bridge running while using live documents.

Codex uses its local provider configuration and authentication. Every generation
creates a persistent native session; questions on generated articles fork their
source session independently. Every Ask on imported Markdown or PDF starts a new
session with the readable article. Unavailable history fails explicitly.

Documents and attachments live under `~/.rabbithole/` (`RABBITHOLE_DIR` overrides).
After clearing browser data, pair again to reopen the same library. Existing
browser-held documents are not migrated. Native history stays with Codex on this
computer. Exports and offline snapshots omit local session references. The bridge
binds to loopback and requires pairing. There is no Rabbithole account or hosted
document store.

Claude Code and OpenCode execution are TODOs. Rabbithole's public MCP workflow and
direct model endpoints have been removed. This release has no settings or session
reference migration.

## Run the browser version locally

```bash
npm install
npm run build
node bin/rabbithole.js bridge --no-open
```

Serve `web/dist/` with a static server and an entry-page fallback.

- [Architecture](docs/02-architecture.md)
- [Data and trust](docs/03-data-and-trust.md)
- [Testing](docs/testing.md)
- [Deployment and bridge operations](docs/06-deploy.md)
- [Data contracts](docs/compatibility.md)
- [Design system](docs/design-system.md)
- [Historical proposals](docs/proposals/README.md)

The shared core executes as ES modules. Browser bundles in `dist/` are committed;
frozen snapshots embed their runtimes and assets for offline reading.

## License

MIT. See [LICENSE](LICENSE).
