# Rabbithole

Rabbithole is a branching reading canvas. Questions on documents produce child
documents that readers can explore independently.

Answers retain the complete quoted content and question at their beginning,
including when folded. Folding hides the answer while keeping the reason for
the branch readable.

Canvas organization keeps branches visually distinct and prevents document
cards from obscuring other branches' connector lines. Organized layouts show
successive relationship depths in successive columns. Each parent is vertically
centered over the space reserved for its child branches, which accounts for
their descendant documents rather than requiring equal sibling spacing.
Readers can freely drag cards; organizing the canvas repairs resulting overlaps.

Generation goes through a local bridge to a configured coding-agent backend.
Direct model endpoints and MCP-driven answering are outside the product's
intended usage.

Every answer uses a new backend conversation. Questions on generated articles
fork the source conversation; questions on imported Markdown or PDF articles
start fresh conversations. Native conversation history cannot cross backends.

Readers choose a backend, model, and reasoning effort. PDF transcription uses
the selected model and requires vision support. Connection pairing is separate
from model choice.
