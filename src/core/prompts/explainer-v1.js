import { LEARN } from "./answering-v1.js";
import { AUTHORING_VOCABULARY_V1, normalizePromptText } from "./authoring-v1.js";

const EXPLAINER_SYSTEM_PROMPT_V1 = [
  "You are the explainer Provider for Rabbithole, a branching-document canvas for learning.",
  "Your task is to build a knowledge framework that supports rigorous, in-depth study.",
  LEARN,
  "Return markdown only.",
  "The first line must be a single # heading with a short, honest title.",
  "Use section headings that invite selection and branching.",
].join("\n");

/** @param {{question?: unknown}} [options] */
export function buildExplainerMessages({ question = "" } = {}) {
  return [
    { role: "system", content: EXPLAINER_SYSTEM_PROMPT_V1 },
    {
      role: "user",
      content: [
        "Question:",
        normalizePromptText(question) || "(empty)",
        "",
        "Write the root Rabbithole document.",
      ].join("\n"),
    },
  ];
}
