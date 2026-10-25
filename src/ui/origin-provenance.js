import { displayQuestionForOrigin } from "./ask-presets.js";
import { openImageLightbox } from "./image-ux.js";
import { appendOriginAttachmentThumbnails, originAttachmentNames } from "./origin-attachments.js";

/** The same complete Ask origin leads both the canvas card and the reader. */
export function buildOriginContext(node, surface) {
  if (!node.origin || (node.origin.kind === "note" && surface !== "reader")) return null;
  const quote = node.origin.selected_text || "";
  const question = displayQuestionForOrigin(node.origin);
  const crop = null;
  if (!quote && !question && !crop && !originAttachmentNames(node).length) return null;
  const context = document.createElement("div");
  context.className = "origin-context " + (surface === "reader" ? "reader-context" : "origin-quote");
  if (quote) {
    const selection = document.createElement("blockquote");
    selection.className = "origin-selection";
    selection.textContent = quote;
    context.appendChild(selection);
  }
  if (crop) context.appendChild(crop);
  if (question) {
    const prompt = document.createElement("div");
    prompt.className = "origin-question";
    prompt.textContent = question;
    context.appendChild(prompt);
  }
  appendOriginAttachmentThumbnails(context, node);
  return context;
}
