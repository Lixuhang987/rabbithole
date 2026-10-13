import { normalizePromptText } from "./authoring-v1.js";
import { parseBlockInfo } from "../blocks.js";
import { lensLabel } from "../hole/lens.js";

export const LEARN = `
Reader likes to keep asking follow-up questions about the current problem until understanding the underlying principles.
Reader cares about why a piece of knowledge matters to the current problem than about learning concepts in isolation.

Reader's main background is in software engineering. I have a software engineering degree, have studied the basics of data structures, computer systems, operating systems, and computer networks, and am familiar with frontend and backend development.

Explain the mechanisms, reasoning, or evidence essential to the current question. When deferring complex details, show their essential structure and identify what remains to be explored.
If a detail can temporarily be treated as a black box, do not simply omit it. Briefly explain its general mechanism while retaining relevant technical terms. 

Correct misunderstandings directly.
If reader's understanding is only partially correct, clearly explain:
- Which parts are correct.
- Which parts need correction.
- What the correct causal relationship is.

The goal is not to cover the entire field in one answer. It is to help reader understand the current problem and leave clear entry points for deeper study in subsequent branches.
**The reader need not understand every sentence immediately; unfamiliar concepts and the questions they raise are valuable entry points for further exploration.**
`

const ANSWERING_SYSTEM_PROMPT_V1 = [
  "You are the web Provider for Rabbithole, a branching-document canvas.",
  "Your task is to build a knowledge framework that supports rigorous, in-depth study.",
  LEARN,
  "Write a markdown answer to the human's question using the supplied parent document and lineage context.",
  "The first line of every answer MUST be exactly: TITLE: <short node title>",
  "After that line, write the answer markdown.",
  "Keep titles short, concrete, and useful as canvas node labels.",
  "When external information is needed, use web search first. Use ego-browser only when web search is unavailable, fails, or cannot retrieve the required content. This order takes precedence over any browser-first preference in the ego-browser skill.",
].join("\n");

/** @typedef {Record<string, any>} AnswerContext */

/** @param {AnswerContext} context @param {{ incremental?: boolean }} [options] @returns {Array<{role: string, content: any}>} */
export function buildAnswerMessages(context, { incremental = false } = {}) {
  let packed = incremental ? packIncrementalAsk(context) : packBranchContext(context);
  const attachments = imageAttachments(context);
  if (attachments.length) {
    if (attachments.every((attachment) => attachment.source === "pasted_image")) {
      packed = `${attachments.length === 1 ? "Pasted image" : "Pasted images"}: attached. Use ${attachments.length === 1 ? "it" : "them"} as part of the human's question.\n${packed}`;
    } else {
      const attachment = attachments[0];
      if (!attachment) throw new Error("Image attachment list unexpectedly became empty");
      const label = attachment.source === "parent_crop" ? "Parent clip image" : "Selection region image";
      packed = `${label}: attached (page ${attachment.page}). Trust the image over extracted text for math, tables, and figures.\n${packed}`;
    }
  }
  return [
    { role: "system", content: ANSWERING_SYSTEM_PROMPT_V1 },
    { role: "user", content: attachments.length ? [
      { type: "text", text: packed },
      ...attachments.map((attachment) => ({ type: "image_url", image_url: { url: attachment.data_url } })),
    ] : packed },
  ];
}


/** Bootstrap context excludes the current Ask and its attachments. @param {AnswerContext} context */
export function buildConversationBaselineMessages(context) {
  return [
    { role: "system", content: ANSWERING_SYSTEM_PROMPT_V1 },
    { role: "user", content: packBranchContext(context, { baseline: true }) },
  ];
}

/** @param {AnswerContext} context */
function packIncrementalAsk(context) {
  const selectedText = normalizePromptText(context.selected_text || context.selectedText || "");
  const blockId = context.anchor?.block?.block_id || context.block_id;
  const source = blockId ? selectedVisualSource(context.parent_markdown || "", blockId) : "";
  return [
    "Continue from the source article in the inherited conversation. Answer only this new Ask.",
    `Lens: ${context.lens || "none"}`,
    "Preset instruction:", context.instruction || "(none)",
    "Human selection:", selectedText || "(whole-article follow-up)",
    ...(blockId ? [`Selection location: visual block ${blockId}`, ...(source ? ["Selected visual source:", source] : [])] : []),
    "Human question:", context.question || "Explain the selected content or the source article.",
    "Start with TITLE: on the first line, then markdown.",
  ].join("\n");
}

/** @param {string} markdown @param {string} blockId */
function selectedVisualSource(markdown, blockId) {
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lines[i] || "");
    if (!open) continue;
    const marker = open[2] || "";
    const start = i;
    const selected = parseBlockInfo(open[3]).id === blockId;
    while (++i < lines.length) {
      const close = /^( {0,3})(`{3,}|~{3,})\s*$/.exec(lines[i] || "");
      const closeMarker = close?.[2] || "";
      if (close && closeMarker[0] === marker[0] && closeMarker.length >= marker.length) break;
    }
    if (selected) return lines.slice(start, i + 1).join("\n");
  }
  return "";
}

/** @param {AnswerContext} context @returns {Record<string, any>[]} */
function imageAttachments(context) {
  const source = Array.isArray(context?.attachments) ? context.attachments : [context?.attachment];
  return source.filter((attachment) => attachment?.kind === "image" && attachment.data_url);
}

/** @param {AnswerContext} context @param {{ baseline?: boolean }} [options] */
function packBranchContext(context, { baseline = false } = {}) {
  const rootTitle = normalizePromptText(context?.root_title || context?.rootTitle || "Untitled");
  const rootQuestion = normalizePromptText(context?.root_question || "");
  const parentTitle = normalizePromptText(context?.parent_title || context?.parentTitle || "Untitled");
  const selectedText = normalizePromptText(context?.selected_text || context?.selectedText || "");
  const blockId = normalizePromptText(context?.anchor?.block?.block_id || context?.block_id || "");
  const question = normalizePromptText(context?.question || "");
  const lens = normalizePromptText(context?.lens || "");
  const presetInstruction = normalizePromptText(context?.instruction || "");
  const lensLine = lens ? `${lens} (${lensLabel(lens) || lens})` : "none";
  const noteLines = summarizeNotes(context?.notes || [], context);
  const notesSection = noteLines ? `\nNotes:\n${noteLines}\n\n` : "";
  const ancestorLines = summarizeAncestors(context?.ancestors || []);

  const header = [
    `Root title: ${rootTitle}`,
    ...(rootQuestion ? ["Original canvas question:", rootQuestion, ""] : []),
    `Parent title: ${parentTitle}`,
    ...(!baseline ? [
    `Lens: ${lensLine}`,
    "Preset instruction:",
    presetInstruction || "(none)",
    "",
    "Human selection:",
    selectedText || "(none; this is a follow-up about the parent document as a whole)",
    "Selection location:",
    blockId ? `Rendered visual block ${blockId}; its fenced source is in the parent markdown.` : "(document prose)",
    "",
    "Human question:",
    question || (selectedText ? "(the selected content)" : "(the parent document as a whole)"),
    "",
    ] : []),
  ].join("\n");

  const parentPrefix = "Parent document markdown:\n";
  const ancestorPrefix = "\n\nAncestor chain (root to parent, title + content):\n";
  const instruction = baseline ? "" : [
    "",
    "Answer the human's question. Start with TITLE: on the first line, then markdown.",
  ].join("\n");

  const parentMarkdown = normalizePromptText(context?.parent_markdown || context?.parentMarkdown || "");
  return header + notesSection + parentPrefix + parentMarkdown + ancestorPrefix + ancestorLines + instruction;
}

/** @param {unknown} notes @param {AnswerContext} context */
function summarizeNotes(notes, context) {
  const list = Array.isArray(notes) ? notes : [];
  return list.map((entry) => {
    const selectedText = normalizePromptText(entry?.on_selected_text || "");
    const content = normalizePromptText(entry?.content || "");
    const onNodeId = normalizePromptText(entry?.on_node_id || "");
    const onTitle = noteParentTitle(onNodeId, context);
    const prefix = selectedText ? `Anchored to "${selectedText}": ` : (onTitle ? `On "${onTitle}": ` : "");
    const author = entry?.author === "agent" ? "Agent" : "Human";
    return `- ${author}: ${prefix}${content}`;
  }).join("\n");
}

/** @param {string} nodeId @param {AnswerContext} context */
function noteParentTitle(nodeId, context) {
  if (!nodeId) return "";
  if (nodeId === normalizePromptText(context?.parent_id || context?.parentId || "")) {
    return normalizePromptText(context?.parent_title || context?.parentTitle || "");
  }
  const ancestors = Array.isArray(context?.ancestors) ? context.ancestors : [];
  const ancestor = ancestors.find((entry) => normalizePromptText(entry?.id || "") === nodeId);
  return normalizePromptText(ancestor?.title || "");
}

/** @param {unknown} ancestors */
function summarizeAncestors(ancestors) {
  const list = Array.isArray(ancestors) ? ancestors : [];
  if (!list.length) return "(none)";
  return list.map((entry, index) => {
    const title = normalizePromptText(entry?.title || `Ancestor ${index + 1}`);
    const excerpt = normalizePromptText(entry?.markdown || entry?.excerpt || "");
    return `${index + 1}. ${title}${excerpt ? ` - ${excerpt}` : ""}`;
  }).join("\n");
}
