# Testing Rabbithole

Rabbithole groups tests by the kind of promise they protect: local behavior, cross-module contracts, host integration, browser journeys, performance budgets, and installed-package behavior.

The executable test runner discovers every test in the selected directory. A new test needs no hand-maintained command list. `npm test` selects the six deterministic tiers below; installed-agent acceptance checks live separately in `test/isolation-live/` and run only through `npm run check:isolation-live`. The runner reports every failure and ends with passed, failed, and skipped totals.

Every test begins with an `@protects` declaration beside the code. The [generated test map](generated/test-map.md) is the authoritative, current inventory of files and capabilities. The [generated command map](generated/commands.md) is the authoritative command reference.

Use the narrowest tier that can observe a behavior:

1. Unit tests protect pure transformations and tightly scoped interface logic.
2. Contract tests protect persisted formats, protocols, trust boundaries, bundle graphs, and storage behavior.
3. Integration tests protect a capability spanning the shared kernel and a host.
4. End-to-end tests protect browser journeys, input ownership, accessibility, and document portability.
5. Performance tests protect reviewed size and timing ceilings.
6. Packaging tests protect clean installation and startup behavior.
7. Isolation-live tests protect Codex capability isolation against locally installed agent binaries. They are opt-in acceptance checks, never part of `npm test`.

Browser tests should prefer accessible roles, focus, keyboard operation, persisted outcomes, network scope, and exported artifacts over private DOM structure. Format tests should prove both acceptance of supported data and clear refusal of unsupported data.

Performance ceilings are reviewed product decisions. Recalibration merges new measurements into their existing rationale instead of replacing that context.

Live-provider evaluations are opt-in quality probes, not deterministic gates. Credentials and private documents never belong in fixtures, logs, snapshots, or committed output.
