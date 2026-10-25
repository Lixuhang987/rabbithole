import { systemClock } from "../core/clock.js";
import { isDockedNote, isNoteNode } from "../core/hole/ask.js";
import { makeNode } from "../core/hole/node.js";
import { DEFAULT_CHILD } from "../core/layout.js";
import { updateComposerState, updateSelectionComposerState } from "./ask-followups.js";
import { removeNodesLocal } from "./branch-surfaces.js";
import {
  createNodeEl,
  drawEdges,
  fillBody,
  renderVisibility,
  rollbackNoteConversion,
  scheduleEdges,
  syncNodeCanvasPresentation,
  updateCardComposer,
} from "./canvas/index.js";
import {
  bannerNotice,
  buildLoading,
  canvasBuilt,
  closed,
  currentNodeId,
  fillStreaming,
  frozen,
  hydration,
  mode,
  nextOrder,
  nodes,
  readerMain,
  registerNode,
  sessionPhase,
  view,
  viewAdjusted,
} from "./core.js";
import { cancelFrame, nextFrame } from "./kit/scope.js";
import { renderBreadcrumb, renderMarginNotes, renderReaderBody } from "./reader.js";
import { refreshNodeHtml } from "./renderer.js";
import { applyServerEvent } from "./store/apply-server-event.js";
import { upgradeMarks, wrapInContainer } from "./text-marks.js";
import { refreshVisualMarks } from "./visuals.js";

// ===========================================================================
// transport
// ===========================================================================
let transportAdapter = null;
let webTransport = null;
let transportEpoch = 0;
let transportDisposed = true;
let transportDisposePromise = null;

export function setTransportAdapter(adapter) {
  transportAdapter = adapter && typeof adapter === "object" ? adapter : null;
}

export function initTransportStatus() {
  transportEpoch += 1;
  transportDisposed = false;
  transportDisposePromise = null;
}

export function post(payload) {
  if (frozen) return Promise.resolve({ ok: true }); // a snapshot has no server
  if (transportDisposed) return Promise.resolve(null);
  return postWithAdapter(transportAdapter, payload);
}
export function putAsset(name, blob) {
  if (frozen) return Promise.resolve({ ok: false });
  if (transportDisposed) return Promise.resolve(null);
  if (transportAdapter && typeof transportAdapter.putAsset === "function") {
    return Promise.resolve(transportAdapter.putAsset(name, blob)).catch(function () {
      return null;
    });
  }
  return Promise.resolve(null);
}
export function deleteAsset(name) {
  if (frozen) return Promise.resolve({ ok: false });
  if (transportDisposed) return Promise.resolve(null);
  if (transportAdapter && typeof transportAdapter.deleteAsset === "function") {
    return Promise.resolve(transportAdapter.deleteAsset(name)).catch(function () {
      return null;
    });
  }
  return Promise.resolve(null);
}
function postWithAdapter(adapter, payload) {
  if (adapter && typeof adapter.post === "function") {
    return Promise.resolve(adapter.post(payload)).catch(function () {
      return null;
    });
  }
  return Promise.resolve(null);
}
// Where-was-I, persisted (debounced) on every meaningful move so a reopen —
// tomorrow or after a crash — lands exactly here.
/** @type {ReturnType<typeof setTimeout> | 0} */
let viewSaveTimer = 0;
function currentViewState() {
  const cur = nodes[currentNodeId];
  const scroll = mode === "reader" ? readerMain.scrollTop : (cur && cur._scrollTop) || 0;
  const state = { mode: mode, node_id: currentNodeId, scroll: scroll };
  if (viewAdjusted) state.view = { x: view.x, y: view.y, scale: view.scale };
  return state;
}
export function scheduleViewSave() {
  if (frozen || closed || transportDisposed) return;
  if (viewSaveTimer) clearTimeout(viewSaveTimer);
  viewSaveTimer = setTimeout(function () {
    viewSaveTimer = 0;
    if (closed) return;
    post({ type: "view_state", state: currentViewState() });
  }, 600);
}
let saveTimers = {};
function nodeUpdatePayload(node) {
  const payload = { type: "node_update", node_id: node.id, title: node.title };
  // A docked note has no place on the canvas, so an update must not invent
  // geometry for it — only its words and its name are durable.
  if (!isDockedNote(node)) {
    payload.position = { x: node.position.x, y: node.position.y };
    payload.size = { w: node.size.w, h: node.size.h };
    payload.collapsed = node.collapsed;
    payload.font_scale = node.font_scale;
  }
  if (isNoteNode(node)) payload.markdown = node.markdown;
  return payload;
}
export function persistNode(node) {
  if (transportDisposed || node._ephemeral) return;
  if (saveTimers[node.id]) clearTimeout(saveTimers[node.id]);
  saveTimers[node.id] = setTimeout(function () {
    delete saveTimers[node.id];
    post(nodeUpdatePayload(node));
  }, 350);
}
export function flushPendingSaves() {
  return flushPendingSavesWith(post);
}
function flushPendingSavesWith(postPending) {
  const pending = saveTimers;
  saveTimers = {};
  const posts = Object.keys(pending).map(function (id) {
    clearTimeout(pending[id]);
    const node = nodes[id];
    if (!node) return Promise.resolve();
    return postPending(nodeUpdatePayload(node));
  });
  if (viewSaveTimer) {
    clearTimeout(viewSaveTimer);
    viewSaveTimer = 0;
    posts.push(postPending({ type: "view_state", state: currentViewState() }));
  }
  return Promise.all(posts);
}
// One request for a whole-layout change (Tidy) instead of N debounced posts.
export function persistNodesBulk(list) {
  if (transportDisposed || !list || !list.length) return;
  const durable = list.filter(function (n) {
    return n && !n._ephemeral;
  });
  if (!durable.length) return;
  post({
    type: "nodes_update",
    nodes: durable.map(function (n) {
      const update = {
        node_id: n.id,
        position: { x: n.position.x, y: n.position.y },
        size: { w: n.size.w, h: n.size.h },
        collapsed: n.collapsed,
      };
      update.font_scale = n.font_scale;
      return update;
    }),
  });
}
export function connectTransport() {
  if (transportDisposed) return null;
  closeConnections();
  const epoch = ++transportEpoch;
  if (transportAdapter && typeof transportAdapter.connect === "function") {
    webTransport = transportAdapter.connect({
      after: hydration.last_event_id || 0,
      onMessage: function (msg) {
        if (isCurrentTransport(epoch)) handleServer(msg);
      },
    });
    return webTransport;
  }
  return null;
}
/** @type {number | ReturnType<typeof setTimeout>} */
let streamRenderRaf = 0;
let streamRenderQueue = {};
function hasStreamSurface(node) {
  return !!node.bodyEl || (mode === "reader" && (currentNodeId === node.id || currentNodeId === node.parent_id));
}
function cancelQueuedStreamRender(nodeId) {
  delete streamRenderQueue[nodeId];
}
function scheduleStreamRender(node, firstChunk) {
  if (transportDisposed) return;
  const epoch = transportEpoch;
  const queued = streamRenderQueue[node.id];
  streamRenderQueue[node.id] = { node: node, firstChunk: queued ? queued.firstChunk : firstChunk };
  if (streamRenderRaf) return;
  streamRenderRaf = nextFrame(function () {
    streamRenderRaf = 0;
    const batch = streamRenderQueue;
    streamRenderQueue = {};
    if (!isCurrentTransport(epoch)) return;
    Object.keys(batch).forEach(function (id) {
      const item = batch[id];
      if (!item.node || item.node.status !== "pending") return;
      if (!hasStreamSurface(item.node)) return;
      refreshNodeHtml(item.node);
      renderStreamSurfaces(item.node, item.firstChunk);
    });
  });
}
function cancelStreamRender() {
  if (streamRenderRaf) cancelFrame(streamRenderRaf);
  streamRenderRaf = 0;
  streamRenderQueue = {};
}
function isCurrentTransport(epoch) {
  return !transportDisposed && epoch === transportEpoch;
}
function closeConnections() {
  if (webTransport && typeof webTransport.close === "function") {
    try {
      webTransport.close();
    } catch (e) {}
  }
  webTransport = null;
}
export function disposeTransportStatus() {
  if (transportDisposePromise) return transportDisposePromise;
  if (transportDisposed) {
    transportAdapter = null;
    return Promise.resolve();
  }
  const adapter = transportAdapter;
  transportDisposed = true;
  transportEpoch += 1;
  closeConnections();
  cancelStreamRender();
  transportDisposePromise = Promise.resolve(
    flushPendingSavesWith(function (payload) {
      return postWithAdapter(adapter, payload);
    }),
  ).finally(function () {
    if (transportAdapter === adapter) transportAdapter = null;
  });
  return transportDisposePromise;
}
// Repaint a streaming node everywhere it is currently on screen: the reader
// main doc, its branch-rail card, and its canvas card. Scroll positions
// are restored exactly on every repaint — arriving text must never move the
// human's place (an innerHTML swap briefly collapses scrollHeight, which
// would otherwise clamp the scroll and make the view jump).
function renderStreamSurfaces(node, firstChunk) {
  if (node.bodyEl) {
    const cs = node.bodyEl.scrollTop;
    fillBody(node);
    node.bodyEl.scrollTop = cs;
    scheduleEdges();
  }
  if (mode !== "reader") return;
  const keep = readerMain.scrollTop;
  if (currentNodeId === node.id) {
    const rdc = readerMain.querySelector('.doc-content[data-node-id="' + node.id + '"]');
    if (rdc) {
      rdc.innerHTML = "";
      if (node.html) fillStreaming(rdc, node, "reader:" + node.id);
      else rdc.appendChild(buildLoading(node));
      readerMain.scrollTop = keep;
    }
  } else if (currentNodeId === node.parent_id) {
    // The branch streams live inside its rail card: the first chunk rebuilds
    // the card (Thinking… → Writing… + the live pane), later chunks patch it.
    const layer = document.getElementById("margin-notes");
    const live = layer && layer.querySelector('.side-item[data-child="' + node.id + '"] .si-live .md');
    if (live && !firstChunk) live.innerHTML = node.html || "";
    else renderMarginNotes();
  }
}

function handleServer(msg) {
  const result = applyServerEvent({ nodes: nodes, register: registerNode }, msg, {
    createPending: function (message) {
      const pos = message.position || {};
      const recovered = Object.assign(
        makeNode({
          id: message.node_id,
          parent_id: message.parent_id || null,
          title: message.title || "…",
          html: "",
          markdown: "",
          base_url: message.base_url || null,
          base_url_source: message.base_url_source || null,
          read: false,
          origin: message.origin || null,
          position: { x: pos.x || 0, y: pos.y || 0 },
          size: { w: DEFAULT_CHILD.w, h: DEFAULT_CHILD.h },
          collapsed: false,
          status: "pending",
        }),
        { html: "", _order: nextOrder(), _startTs: systemClock.now() },
      );
      recovered.font_scale = message.font_scale || recovered.font_scale;
      return recovered;
    },
  });
  if (result.handled) {
    if (result.type === "node_deleted") {
      removeNodesLocal(result.nodeIds || [], null);
      return;
    }
    const node = result.node;
    if (!node) return;
    if (result.created) {
      if (canvasBuilt) {
        createNodeEl(node);
        renderVisibility();
        drawEdges();
      }
      if (node.origin && node.origin.anchor) {
        if (mode === "reader")
          wrapInContainer(
            readerMain.querySelector('.doc-content[data-node-id="' + node.parent_id + '"]'),
            node.origin.anchor,
            node.id,
            "hl mark-pending",
          );
        const pp = nodes[node.parent_id];
        if (pp && pp.bodyEl)
          wrapInContainer(pp.bodyEl.querySelector(".doc-content"), node.origin.anchor, node.id, "hl mark-pending");
      }
      const blockId = node.origin?.anchor?.block?.block_id;
      if (blockId && node.parent_id) refreshVisualMarks(node.parent_id, blockId);
    }
    if (result.type === "node_answered") {
      cancelQueuedStreamRender(node.id);
      delete node._noteConversionRollback;
      if (hasStreamSurface(node)) refreshNodeHtml(node);
      if (node.titleEl) {
        node.titleEl.textContent = node.title;
        node.titleEl.title = node.title;
      }
      if (node.bodyEl) {
        fillBody(node);
        scheduleEdges();
      }
      updateCardComposer(node);
      refreshOpenStandaloneComposers();
      if (mode === "reader") {
        // The answered node itself may be open (e.g. opened pending from canvas).
        if (currentNodeId === node.id) {
          renderBreadcrumb();
          renderReaderBody();
          renderMarginNotes();
          updateComposerState();
        } else {
          // The parent doc may be on screen as the main document OR as a
          // follow-up answer in the thread — upgrade marks wherever they are.
          upgradeMarks(readerMain, node.id);
          if (currentNodeId === node.parent_id) renderMarginNotes();
        }
      }
      // Upgrade the inline mark inside the parent's canvas card too.
      const p = nodes[node.parent_id];
      if (p && p.bodyEl) upgradeMarks(p.bodyEl, node.id);
    } else if (result.type === "node_progress") {
      if (result.invalidated.has("stream")) scheduleStreamRender(node, result.firstChunk);
    } else if (result.type === "node_search_status") {
      if (!result.invalidated.has("status")) return;
      cancelQueuedStreamRender(node.id);
      renderStreamSurfaces(node, true);
      updateCardComposer(node);
      refreshOpenStandaloneComposers();
    } else if (result.type === "node_extensions_patch") {
      if (result.namespace === "canvas") syncNodeCanvasPresentation(node);
      else if (result.namespace !== "attention") {
        if (node.bodyEl) fillBody(node);
        if (mode === "reader" && currentNodeId === node.id) renderReaderBody();
        updateCardComposer(node);
        refreshOpenStandaloneComposers();
        scheduleEdges();
      }
    } else if (result.type === "node_error") {
      if (result.restoreNote) {
        rollbackNoteConversion(node);
        return;
      }
      if (!result.invalidated.has("document")) return;
      cancelQueuedStreamRender(node.id);
      refreshNodeHtml(node);
      renderStreamSurfaces(node, !node.markdown);
      if (node.bodyEl) {
        fillBody(node);
        scheduleEdges();
      }
      if (mode === "reader") {
        if (currentNodeId === node.id) {
          renderReaderBody();
          updateComposerState();
        } else if (currentNodeId === node.parent_id) renderMarginNotes();
      }
    }
    return;
  }
}

export function refreshStatus() {
  const phase = sessionPhase();
  document.body.classList.toggle("agent-down", phase !== "live");
  document.body.classList.toggle("session-over", phase === "closed" || phase === "frozen");
  bannerNotice.hide();
  if (mode === "reader") renderMarginNotes();
  updateComposerState();
  updateSelectionComposerState();
  if (canvasBuilt) for (const cid in nodes) updateCardComposer(nodes[cid]);
}

function refreshOpenStandaloneComposers() {
  for (const id in nodes) if (nodes[id]._noteComposer) updateCardComposer(nodes[id]);
}
