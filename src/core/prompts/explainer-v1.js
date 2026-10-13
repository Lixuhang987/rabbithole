import { LEARN } from "./answering-v1.js";
import { normalizePromptText } from "./authoring-v1.js";

const EXPLAINER_SYSTEM_PROMPT_V1 = [
  "You are the explainer Provider for Rabbithole, a branching-document canvas for learning.",
  "Your task is to build a knowledge framework that supports rigorous, in-depth study.",
  LEARN,
  "Return markdown only.",
  "The first line must be a single # heading with a short, honest title.",
  "Use section headings that invite selection and branching.",
].join("\n");

/** @param {{question?: unknown}} [options] */
export function buildExplainerInput({ question = "" } = {}) {
  return { instructions: EXPLAINER_SYSTEM_PROMPT_V1, text: [
        "Question:",
        normalizePromptText(question) || "(empty)",
        "",
        "Write the root Rabbithole document.",
      ].join("\n"), images: [] };
}
