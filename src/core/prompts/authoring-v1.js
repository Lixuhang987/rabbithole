export const AUTHORING_VOCABULARY_V1 = [
  " "
].join("\n");

const AUTHORING_SYSTEM_PROMPT_V1 = [
  "You are the document authoring Provider for Rabbithole, a branching-document canvas.",
  "Turn raw pasted text or extracted URL content into one well-structured markdown source document.",
  "",
  "Return markdown only. Do not wrap the document in a code fence and do not emit a TITLE sentinel.",
  "Start with one # heading. Use the supplied title when it is accurate; otherwise infer a short, honest title from the source.",
  "Organize the source into useful sections with headings, lists, tables, math, code fences, and diagrams only when the source supports them.",
  "Preserve source math exactly when possible, including $...$/$$...$$ and \\(...\\)/\\[...\\] delimiters.",
  "Preserve source code in language-tagged fenced blocks when a language is clear; otherwise use plain fenced code.",
  "Keep URLs, citations, numbers, names, and technical claims faithful to the source.",
  "Do not invent facts, citations, examples, images, or conclusions. If the source is fragmentary, make the document modest rather than filling gaps.",
  "If the source already looks like clean markdown, improve only obvious structure and formatting problems.",
  "",
  AUTHORING_VOCABULARY_V1,
].join("\n");

/**
 * @typedef {object} AuthorSource
 * @property {unknown} [title]
 * @property {unknown} [name]
 * @property {unknown} [source_name]
 * @property {unknown} [base_url]
 * @property {unknown} [baseUrl]
 * @property {unknown} [kind]
 * @property {unknown} [type]
 * @property {unknown} [markdown]
 * @property {unknown} [content]
 * @property {unknown} [text]
 */

/** @param {AuthorSource} [source] */
export function buildAuthorMessages(source = {}) {
  const title = normalizePromptText(source.title || source.name || source.source_name || "");
  const baseUrl = normalizePromptText(source.base_url || source.baseUrl || "");
  const kind = normalizePromptText(source.kind || source.type || "source");
  const content = normalizePromptText(source.markdown || source.content || source.text || "");
  return [
    { role: "system", content: AUTHORING_SYSTEM_PROMPT_V1 },
    {
      role: "user",
      content: [
        `Source kind: ${kind || "source"}`,
        `Suggested title: ${title || "(none)"}`,
        `Base URL: ${baseUrl || "(none)"}`,
        "",
        "Source content:",
        content || "(empty)",
        "",
        "Author this source into a standalone Rabbithole markdown document.",
      ].join("\n"),
    },
  ];
}

/** @param {unknown} value */
export function normalizePromptText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}
