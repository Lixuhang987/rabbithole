---
status: shipped
date: 2026-10-26
---

# Folded card hover preview

## Confirmed direction

Folded cards return to a compact header with a truncated document title.
Hovering a folded card reveals an enlarged preview centered in the browser
viewport. This replaces displaying complete Ask origins inside folded cards,
as described in [Complete Ask origin display](ask-origin-display.md).

The preview shows quoted content, the full saved prompt, attachment thumbnails
and the answer body in document order; a separate title is optional. Ordinary
cards and reader mode continue to show the complete quote and prompt before
the answer.

Automatic and manual folds, pinned folded cards and newly exported frozen
snapshots share this behavior. Pinned cards' canvas placeholders do not trigger
duplicate previews. Imported documents and notes with no Ask origin retain only
their folded title, without introducing a body preview. Existing exported HTML
is unchanged.

Hovering the source tab for 300ms opens one preview. Only the source tab is a
hover anchor: leaving it closes the preview immediately. Moving into a preview
does not keep it open. The display-only layer accepts no pointer events and
must not obscure the source tab's hit target even when they overlap visually.
It provides no scrolling, text selection, image activation or touch entry.
While the preview is visible, plain Tab opens that document through the same
Expand document action as its header icon. Other keyboard navigation remains
unchanged, including Shift+Tab and Tab while typing or before a preview appears.
Original tab actions remain available; hovering action buttons, pointer-down,
dragging, expanding or opening a menu cancels the preview. Interactive overlays
suppress previews, including when
opened by keyboard, and retain ownership of Tab navigation.

The preview is independent of canvas zoom, centered in the browser viewport,
approximately 720px wide with a 90vw limit and an 80vh height limit. Text is
larger than ordinary card text (approximately 18px). There is no background scrim.

## Overflow

The complete document content is present in the preview, but content beyond
80vh is clipped with a bottom fade. A passive Tab hint identifies how to open
the complete document. Short previews do not need a fade. Previewing never
changes persisted content, card dimensions, folded state or canvas layout.
