---
status: superseded
date: 2026-07-08
---

# Static web host

The web host is a second adapter for the same Rabbithole, not a separate product. It is a static, local-first application whose provider key and documents stay in the browser.

The proposal introduced two inversions: Markdown became the canonical browser wire format, and the interface became real modules whose self-contained form is a build artifact. It also established shared store and provider ports, a common reducer, browser persistence, portable files, and direct-first ingestion with a narrow optional fetch relay.

Accounts, telemetry, hosted document storage, and mandatory backends were explicitly excluded.
