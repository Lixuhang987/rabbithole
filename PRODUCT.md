# Rabbithole

Rabbithole is a branching reading canvas. Questions on documents produce child
documents that readers can explore independently.

Answers retain the complete quoted content and question at their beginning.
Folded cards show a truncated title. Hovering a folded card reveals an enlarged,
display-only document preview centered in the browser viewport. Only hovering
the source tab keeps it open. Long content is clipped with a bottom fade;
pressing Tab while previewing opens the document for reading.

Canvas organization makes each document's direct children recognizable as a
cluster, with larger gaps between clusters than within them. Organized layouts
show successive relationship depths in successive independently centered
columns. Connections fan out from shared side-center parent ports to side-center
child ports using cubic Bezier curves. Readers can freely drag cards; organizing
the canvas repairs card overlaps, without guaranteeing that connectors never
cross or pass through unrelated cards. See
[Branch organization](docs/proposals/branch-layout.md).

Generation goes through a local bridge to a configured coding-agent backend.
Direct model endpoints and MCP-driven answering are outside the product's
intended usage.

Every answer uses a new backend conversation. Questions on generated articles
fork the source conversation; questions on imported Markdown or PDF articles
start fresh conversations. Native conversation history cannot cross backends.

Readers choose a backend, model, and reasoning effort. PDF transcription uses
the selected model and requires vision support. Connection pairing is separate
from model choice.
