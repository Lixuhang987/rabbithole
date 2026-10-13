import { stripNodeAttention } from "../../core/hole/node.js";

const DOCUMENT_EVENTS = new Set([
  "node_answered",
  "node_deleted",
  "node_progress",
  "node_search_status",
  "node_extensions_patch",
  "pdf_convert_progress",
  "node_error",
]);

export function applyServerEvent(store, message, options = {}) {
  const type = String(message?.type || "");
  if (!DOCUMENT_EVENTS.has(type)) return { handled: false, invalidated: new Set() };
  const invalidated = new Set();
  const result = { handled: true, type, invalidated, node: null, created: false, firstChunk: false };

  if (type === "node_deleted") {
    result.nodeIds = Array.isArray(message.node_ids) ? message.node_ids : [];
    invalidated.add("nodes");
    return result;
  }

  let node = store.nodes[message.node_id];
  if (!node && type === "node_answered" && typeof options.createPending === "function") {
    node = options.createPending(message);
    if (node) {
      store.register(node);
      result.created = true;
      invalidated.add("nodes");
    }
  }
  result.node = node || null;
  if (!node) return result;

  if (type === "node_answered") {
    node.error = null;
    node._searchStatus = null;
    node._searchCalls = new Map();
    node.status = "answered";
    node.title = message.title || node.title;
    node.markdown = message.markdown || node.markdown || "";
    node.base_url = message.base_url || null;
    node.base_url_source = message.base_url_source || null;
    node.origin = message.origin || node.origin || null;
    node.extensions = stripNodeAttention(node.extensions);
    invalidated.add("document");
    invalidated.add("status");
  } else if (type === "node_progress" && node.status === "pending") {
    result.firstChunk = !node.markdown;
    node.error = null;
    if (!message.markdown) {
      node._searchStatus = null;
      node._searchCalls = new Map();
    }
    node.markdown = message.markdown || "";
    node.base_url = message.base_url || node.base_url || null;
    node.base_url_source = message.base_url_source || node.base_url_source || null;
    invalidated.add("stream");
  } else if (type === "node_search_status" && node.status === "pending") {
    node._searchCalls ||= new Map();
    if (message.status === "searching") {
      node._searchCalls.set(
        message.call_id,
        ["openPage", "findInPage"].includes(message.action) ? "reading" : "searching",
      );
    } else node._searchCalls.delete(message.call_id);
    node._searchStatus = node._searchCalls.values().next().value || null;
    invalidated.add("status");
  } else if (type === "node_extensions_patch") {
    const value =
      message.value && typeof message.value === "object" && !Array.isArray(message.value) ? message.value : {};
    if (message.namespace === "pdf") node.source = Object.keys(value).length ? value : null;
    else if (message.namespace === "canvas") {
      const docked = node.view?.docked === true;
      const reaction = node.view?.reaction === true;
      node.view = { ...value, ...(docked ? { docked: true } : {}), ...(reaction ? { reaction: true } : {}) };
    } else if (message.namespace === "note") {
      node.view = { ...node.view };
      if (value.docked === true) node.view.docked = true;
      else delete node.view.docked;
      if (value.reaction === true) node.view.reaction = true;
      else delete node.view.reaction;
    } else if (message.namespace === "learn") node.progress = value;
    else node.extensions = { ...(node.extensions || {}), [message.namespace]: message.value };
    result.namespace = message.namespace;
    invalidated.add(message.namespace === "canvas" ? "presentation" : "document");
  } else if (type === "pdf_convert_progress") {
    node.markdown = message.markdown || "";
    node._pdfProgress = { done: message.page_done, total: message.page_total };
    invalidated.add("document");
  } else if (type === "node_error" && node.status === "pending") {
    node._searchStatus = null;
    node._searchCalls = new Map();
    result.restoreNote = message.restore_note === true;
    if (!result.restoreNote) {
      node.error = {
        message: message.message || "The provider request failed.",
        code: message.code || null,
        retryable: message.retryable !== false,
      };
      if (message.markdown != null) node.markdown = message.markdown || "";
      invalidated.add("document");
      invalidated.add("status");
    }
  }
  return result;
}
