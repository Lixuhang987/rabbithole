---
status: shipped
date: 2026-10-25
---

# Complete Ask origin display

The folded-card presentation below is replaced by the
[hover preview design](folded-card-hover-preview.md). Document-opening origin
content remains unchanged.

Automatic and manual folds preserve the complete quoted content and question.
Folded cards keep their width, wrap text without line or height limits, and grow
vertically without an internal scrollbar. The answer title remains in the header.

Canvas cards and reader mode show quoted content, then the complete prompt, then
the answer body. Preserve plain text and line breaks; omit absent sections.
Use the same prompt display for ordinary and quick questions, without a separate
quick-question badge or display path. Attachment thumbnails and PDF region
previews remain available when folded and open their images on activation.
New frozen snapshots share this presentation; existing exported HTML is unchanged.

## Rendering and verification boundaries

Origin display reads the saved quote and full prompt without rewriting document
Markdown or changing stored formats. PDF region previews derive from source
coordinates without adding stored assets. Snapshots embed the PDF runtime when
region previews need it, including after source transcription.

Verification extends the existing auto-tidy, root Ask and placed-note reader
flows, plus one media browser flow. It covers long text, measured stack spacing,
reload, image activation with pointer and keyboard, and offline snapshot parity.
The additional frozen runtime costs 4,261 bytes in the reference snapshots; only
the two snapshot-size ceilings increase by this measured delta, retaining their
previous absolute headroom.
