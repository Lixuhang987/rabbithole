import { parseBlockInfo } from "../blocks.js";

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
**Emphasize real production practice, since it is the most valuable entry points**
`

const ANSWERING_INSTRUCTIONS_V1 = [
  "You are the web Provider for Rabbithole, a branching-document canvas.",
  "Your task is to build a knowledge framework that supports rigorous, in-depth study.",
  LEARN,
  "Write a markdown answer to the human's question using the source article or inherited conversation.",
  "The first line of every answer MUST be exactly: TITLE: <short node title>",
  "After that line, write the answer markdown.",
  "Keep titles short, concrete, and useful as canvas node labels.",
  "When external information is needed, use web search first. Use ego-browser only when web search is unavailable, fails, or cannot retrieve the required content. This order takes precedence over any browser-first preference in the ego-browser skill.",
].join("\n");

/** @param {any} context @param {{fork?: boolean}} [options] */
export function buildAnswerInput(context, { fork = false } = {}) {
  const text = [
    ...(fork ? ["Continue from the source article in the inherited conversation. Answer only this new Ask."]
      : ["Source article:", String(context.article?.markdown || ""), "End of source article."]),
    `Lens: ${context.lens || "none"}`,
    "Preset instruction:", context.instruction || "(none)",
    "Human selection:", context.selected_text || "(whole-article follow-up)",
    ...(context.visual_source ? ["Selected visual source:", context.visual_source] : []),
    "Human question:", context.question || "Explain the selected content or the source article.",
  ].join("\n");
  const attachments = context.attachments || [];
  const imageHint = attachments.length ? (attachments.every((/** @type {any} */ image) => image.source === "pasted_image")
    ? "Pasted images are attached as part of the question.\n"
    : "Selection region images are attached. Trust the image for math, tables, and figures.\n") : "";
  return { instructions: ANSWERING_INSTRUCTIONS_V1, text: imageHint + text, images: attachments.map((/** @type {any} */ image) => image.data_url) };
}

/** @param {string} markdown @param {string} blockId */
export function selectedVisualSource(markdown, blockId) {
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
