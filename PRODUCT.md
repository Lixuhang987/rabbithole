# Rabbithole

Rabbithole is a branching reading canvas. Questions on documents produce child
documents that readers can explore independently.

Generation goes through a local bridge to a configured coding-agent backend.
Direct model endpoints and MCP-driven answering are outside the product's
intended usage.

Every answer uses a new backend conversation. Questions on generated articles
fork the source conversation; questions on imported Markdown or PDF articles
start fresh conversations. Native conversation history cannot cross backends.

Readers choose a backend, model, and reasoning effort. PDF transcription uses
the selected model and requires vision support. Connection pairing is separate
from model choice.
