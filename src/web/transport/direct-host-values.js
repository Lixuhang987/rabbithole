import { normalizeBackendConversation } from "../../core/conversation.js";
import { projectNode } from "../../core/hole/node.js";
import { Run } from "../../core/hole/run.js";
import { randomId } from "../../core/utils.js";
import { truncate } from "../../core/hole/lens.js";
import { ProviderError } from "../provider/errors.js";

export const WEB_ROOT_QUESTION = "web_root_question";

/** @param {import("../../core/contracts/engine.js").HoleNode | undefined} node */
export function rawOrigin(node) {
  return /** @type {Record<string, any>} */ (node?.origin || {});
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Image could not be read."));
    reader.readAsDataURL(blob);
  });
}

/** Narrow, browser-free branch wiring: GenerationEvent -> Run -> DocEvent. */
export async function* generationDocEvents(generation, run, { nodeId, progressFields = {}, answeredFields = {}, beforeComplete = null, complete = null }) {
  let conversation = null;
  for await (const event of generation) {
    if (event.type === "conversation") {
      conversation = normalizeBackendConversation(event.conversation);
      if (!conversation || event.nodeId !== nodeId) throw new Error("Invalid conversation completion.");
      continue;
    }
    if (event.type === "search") {
      yield { type: "node_search_status", node_id: nodeId, call_id: event.id, status: event.status, action: event.action, run: { id: run.id } };
      continue;
    }
    const progress = run.accept(event, { nodeId, progressFields });
    if (progress) yield progress;
  }
  beforeComplete?.(run);
  const fields = typeof answeredFields === "function" ? answeredFields() : answeredFields;
  const context = { nodeId, answeredFields: fields };
  const answered = complete ? complete(run, context) : run.complete(context);
  yield { ...answered, ...(conversation ? { backend_conversation: conversation } : {}) };
}

export function rootAnsweredFields(node) {
  if (!node) return {};
  const { id: _id, ...fields } = projectNode(node, "wire");
  return { ...fields, parent_id: null, read: true };
}

export function branchAnsweredFields(node) {
  if (!node) return {};
  const { id: _id, ...fields } = projectNode(node, "wire");
  return { ...fields, read: false };
}

export function defaultRunId() { return randomId("generation"); }
export function fallbackTitleForNode(node) {
  const origin = node?.origin || {};
  if (origin.lens) return origin.lens;
  return truncate(origin.question || node?.title || "Untitled", 72) || "Untitled";
}

export function titleFromMarkdown(markdown) {
  const match = /^#\s+(.+)$/m.exec(String(markdown || ""));
  return match ? truncate(match[1].trim(), 80) : "";
}
export function isAuthError(error) {
  return error?.status === 401 || error?.status === 403 || error?.code === "401" || error?.code === "403" || error?.code === "unauthorized";
}
export function resetMarkdownForRun(node) { return node?.markdown && node.status === "pending" ? String(node.markdown) : ""; }
export function rootQuestionForNode(node) { return String(node?.origin?.[WEB_ROOT_QUESTION] || "").trim(); }

export function rootQuestionMarkdown(question) {
  // Keep Markdown formatting; the shared renderer escapes raw HTML.
  const text = String(question || "").trim().replace(/\r\n?/g, "\n");
  return text ? `> **Original question**\n>\n${text.split("\n").map((line) => `> ${line}`).join("\n")}\n\n` : "";
}
