# Interface

The reader is the primary surface; the canvas is the overview. Both show the same documents and relationships, with no translation step between them.

A card is a view of a document, not a second model. Marks show where questions or human notes began. Docked notes remain ordinary documents even when their presentation lives in a margin.

The interface uses a small set of shared primitives for popovers, menus, dialogs, focus, motion, and cleanup. A mounted surface owns its listeners and observers and releases them through one lifecycle mechanism.

Keyboard, touch, reduced motion, focus restoration, and frozen-read-only behavior are product contracts rather than after-the-fact polish. Host capabilities change which actions are available, but they do not fork the surface.

Design values are authored as tokens and checked mechanically. The hand-written design guide records interpretation and optical judgment; generated sections report the values that actually ship.
