---
status: superseded
date: 2026-08-20
---

# Custom model endpoints

The web host supports an arbitrary OpenAI-compatible endpoint alongside guided hosted and local choices. The setup surface asks for an endpoint, an optional key, and a model, then reports connection state without pretending it can validate model quality or image capability.

Model discovery and generation share address-space policy so a reachable local-network model remains reachable when generation begins. Per-provider settings retain their own endpoint and model values across switches.

Historical provider identifiers are migrated once when stored settings load. Runtime routing uses only canonical identifiers.
