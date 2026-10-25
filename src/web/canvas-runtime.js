// The document canvas is deliberately behind one dynamic boundary in the
// hosted app. The blank landing and project rail do not need the markdown,
// math, snapshot, or transport runtimes; loading this module warms all of
// them together before a Rabbithole is mounted.
export { startRabbithole } from "../ui/entry.js";
export { buildSnapshotHtml, buildSnapshotProjection, setSnapshotHooks } from "../ui/snapshot.js";
export { flushPendingSaves } from "../ui/transport-status.js";
export { registerRendererAssetName } from "../ui/renderer.js";
export { whenViewAnimationSettled } from "../ui/canvas/camera.js";
export { anchorClipBounds, viewportRect as overlayViewportRect } from "../ui/overlay/anchor.js";
