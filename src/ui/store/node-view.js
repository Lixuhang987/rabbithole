const HANDLE_FIELDS = Object.freeze([
  "el",
  "bodyEl",
  "titleEl",
  "actsEl",
  "actDivider",
  "moreBtn",
  "collapseBtn",
  "ncComp",
  "ncInner",
  "ncText",
  "ncActions",
  "ncHandle",
  "_composerAttachments",
  "canvasEl",
  "canvasBodyEl",
  "_noteEditor",
  "_noteEditSurface",
  "_noteComposer",
  "_noteActions",
  "_noteInput",
  "_noteAttachmentStrip",
  "_noteAttachments",
  "_noteUploadedAssets",
  "_noteDockedComposer",
  "_noteConversionRollback",
]);

const RESET_FIELDS = Object.freeze({
  _noteUploading: false,
  _noteNormalizing: false,
  _notePastePending: 0,
});

export function dropNodeView(node) {
  if (!node) return;
  node._composerAttachments?.dispose();
  node._noteDraftDispose?.();
  node._noteEditDispose?.();
  node.el?.remove();
  for (const field of HANDLE_FIELDS) node[field] = null;
  for (const [field, value] of Object.entries(RESET_FIELDS)) node[field] = value;
  node._noteDraftDispose = null;
  node._noteEditDispose = null;
}
