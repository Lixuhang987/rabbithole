import { extractNodeAssetRefs } from "../../core/assets.js";
import { MAX_ASK_ATTACHMENTS } from "../../core/attachments.js";
import { systemClock } from "../../core/clock.js";
import { BRANCH_FOLLOWUP, BRANCH_SELECTION } from "../../core/hole/ask.js";
import { truncate } from "../../core/hole/lens.js";
import { closed, frozen, nodes, postBrowserEvent, readerMain, rootId, uuid } from "../core.js";
import { refreshNodeHtml } from "../renderer.js";
import { setNoteMarks, setPendingMarks } from "../text-marks.js";
import { updateCardComposer } from "./card-composer.js";
import { syncCardTitle } from "./card-title.js";
import { fillBody } from "./document.js";
import { scheduleEdges } from "./edges.js";
import { layoutNode } from "./gestures.js";
import { canConvertNote } from "./menu.js";
import { r } from "./runtime.js";

// Leaving the editor — saved, cancelled, or converted — hands the card's
// bottom edge back to its ordinary body padding and resize corner, and its
// resting height back to layout.
export function endNoteEditingChrome(node) {
  if (!node || !node.el) return;
  node.el.classList.remove("note-editing");
  layoutNode(node);
}

export function startTitleEditing(node, titleEl) {
  if (frozen || closed || titleEl.isContentEditable) return;
  const previous = node.title || "";
  titleEl.textContent = previous;
  titleEl.removeAttribute("title");
  titleEl.setAttribute("contenteditable", "plaintext-only");
  titleEl.focus({ preventScroll: true });
  const range = document.createRange();
  range.selectNodeContents(titleEl);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  let settled = false;
  function finish(save) {
    if (settled) return;
    settled = true;
    const next = titleEl.textContent.trim();
    titleEl.removeEventListener("keydown", onKeyDown);
    titleEl.removeAttribute("contenteditable");
    if (save && next) {
      node.title = next;
      r.lifecycle.hooks.persistNode(node);
    }
    syncCardTitle(node);
    if (document.activeElement === titleEl) titleEl.blur();
  }
  function onKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      finish(true);
    }
  }
  titleEl.addEventListener("keydown", onKeyDown);
  titleEl.addEventListener(
    "blur",
    function () {
      finish(true);
    },
    { once: true },
  );
}

export function setConversionMarkState(node, pending) {
  const parent = node.parent_id == null ? null : nodes[node.parent_id];
  const update = pending ? setPendingMarks : setNoteMarks;
  update(readerMain, node.id);
  if (parent && parent.bodyEl) update(parent.bodyEl, node.id);
}

export function restoreConvertedNote(node, previous) {
  node.title = previous.title;
  node.markdown = previous.markdown;
  node.base_url = previous.base_url;
  node.base_url_source = previous.base_url_source;
  node.read = previous.read;
  node.origin = previous.origin;
  node.status = previous.status;
  node._startTs = previous.startTs;
  if (previous.hadError) node.error = previous.error;
  else delete node.error;
  if (node.el) node.el.classList.add("card-note");
  if (node.titleEl) {
    node.titleEl.textContent = node.title;
    node.titleEl.title = node.title;
  }
  refreshNodeHtml(node);
  fillBody(node);
  layoutNode(node);
  updateCardComposer(node);
  setConversionMarkState(node, false);
  r.lifecycle.hooks.persistNode(node);
  scheduleEdges();
}

export function rollbackNoteConversion(node) {
  const restore = node && node._noteConversionRollback;
  if (!restore) return;
  delete node._noteConversionRollback;
  r.lifecycle.hooks.rollbackBranch(node, restore);
}

export function convertNoteToAsk(node, text, options = {}) {
  const question = (text || "").trim();
  if (!question || !canConvertNote(node)) return false;
  const parentId = node.parent_id == null ? null : node.parent_id;
  const parent = nodes[parentId == null ? rootId : parentId];
  if (!parent) return false;
  const anchor = parentId == null ? null : (node.origin && node.origin.anchor) || null;
  const attachmentNames = Array.from(extractNodeAssetRefs({ markdown: question })).slice(0, MAX_ASK_ATTACHMENTS);
  const previous = {
    title: node.title,
    markdown: question,
    base_url: node.base_url,
    base_url_source: node.base_url_source,
    read: node.read,
    origin: node.origin,
    status: node.status,
    startTs: node._startTs,
    hadError: Object.prototype.hasOwnProperty.call(node, "error"),
    error: node.error,
  };
  endNoteEditingChrome(node);
  node._noteEditor = null;
  node._noteEditSurface = null;
  node.title = truncate(question, 48);
  node.markdown = "";
  node.html = "";
  node.base_url = parent.base_url || null;
  node.base_url_source = parent.base_url ? "inherited" : null;
  node.read = false;
  node.origin = {
    selected_text: anchor ? String(previous.origin.selected_text || "").trim() : "",
    question: question,
    lens: null,
    anchor: anchor,
    branch_type: anchor ? BRANCH_SELECTION : BRANCH_FOLLOWUP,
    ...(attachmentNames.length ? { attachment_assets: attachmentNames } : {}),
  };
  node.status = "pending";
  node._startTs = systemClock.now();
  delete node.error;
  if (node.el) node.el.classList.remove("card-note");
  if (node.titleEl) {
    node.titleEl.textContent = node.title;
    node.titleEl.title = node.title;
  }
  fillBody(node);
  layoutNode(node);
  updateCardComposer(node);
  setConversionMarkState(node, true);
  scheduleEdges();
  node._noteConversionRollback = function () {
    restoreConvertedNote(node, previous);
    if (typeof options.onRollback === "function") options.onRollback(node);
  };
  const payload = {
    type: "branch_request",
    request_id: uuid(),
    node_id: node.id,
    parent_id: parentId,
    selected_text: node.origin.selected_text,
    question: question,
    lens: null,
    anchor: anchor,
    branch_type: node.origin.branch_type,
    position: { x: node.position.x, y: node.position.y },
    size: { w: node.size.w, h: node.size.h },
    ...(attachmentNames.length ? { attachment_assets: attachmentNames } : {}),
  };
  Promise.resolve(postBrowserEvent(payload))
    .then(function (response) {
      if (!response || !response.ok) rollbackNoteConversion(node);
    })
    .catch(function () {
      rollbackNoteConversion(node);
    });
  return true;
}
