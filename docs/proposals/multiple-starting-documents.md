---
status: draft
date: 2026-10-24
---

# Multiple starting documents in one canvas

Readers want to add another starting document to the current canvas instead of
creating a separate canvas. The addition should remain part of that canvas's
saved and portable document graph. Input methods and generation context are
still being discussed; this proposal does not authorize implementation.

## Architecture assessment

The existing graph can represent multiple parentless articles. Persistence,
portable projection, frozen hydration, and graph traversal already preserve
them. Supporting another starting document does not inherently require a new
storage boundary or a change to the browser/bridge ownership described in
[Architecture](../02-architecture.md).

The main risk is confusing a parentless graph node with an independent
generation source. Existing blank-canvas Asks borrow the starting document's
context and native conversation. Reusing that behavior would make an apparently
independent document depend on the original article.

Other workflows still privilege one starting document: automatic tree layout,
initial generation and retry, title updates, and PDF transcription. Multiple
PDFs also require figure asset names that cannot collide within a canvas.
These assumptions must be reviewed together with the new entry point.

## Proposed direction

Keep one canvas as one document graph and asset ownership boundary. Add new
articles to that graph through the existing engine. If independent generation
is chosen, start a new native conversation for each generated starting article;
follow-up answers continue to use that article's own conversation. Generation
remains on the semantic bridge contract.

Preserving the existing designated starting document as the default entry is
the smaller change. Making every starting document interchangeable, including
deleting the original, additionally requires rules for default navigation,
deletion fallback, and the last remaining article.

## Open product decisions

- Inputs: newly imported Markdown, web pages or PDFs; independent AI generation;
  or merging an existing canvas and its branches.
- Context: independent article conversations, or automatic context shared across
  all documents on the canvas.
- Starting document: retain a designated default, or make all roots equal and
  allow the original to be removed.

## Verification boundary

Verify that each tree survives saving, reopening, portable export/import and
frozen snapshots. Exercise layout, deletion and generation failure/retry with
more than one tree. Independent generation must not inherit an unrelated
article's body or native session. If PDFs are included, use two different source
files with overlapping page numbers to verify transcription and figure assets.
