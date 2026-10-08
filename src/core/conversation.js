/** Local Codex history references; never part of a portable document. */
export const CODEX_CONVERSATION = "codex_conversation";

/** @typedef {{version: 1, threadId: string, scopeId: string}} CodexConversation */

/** @param {unknown} value @returns {CodexConversation | null} */
export function normalizeCodexConversation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = /** @type {Record<string, unknown>} */ (value);
  if (raw.version !== 1) return null;
  /** @param {unknown} value */
  const identifier = (value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  if (!identifier(raw.threadId) || !identifier(raw.scopeId)) return null;
  return { version: 1, threadId: /** @type {string} */ (raw.threadId), scopeId: /** @type {string} */ (raw.scopeId) };
}

/** @param {import("./contracts/artifact.js").PersistedHole} hole */
export function withoutLocalConversations(hole) {
  // Imports normalize and validate legacy payloads later in the pipeline.
  if (!Array.isArray(hole.nodes)) return hole;
  const nodes = hole.nodes.map((node) => {
    if (!node?.extensions || !Object.hasOwn(node.extensions, CODEX_CONVERSATION)) return node;
    const extensions = { ...node.extensions };
    delete extensions[CODEX_CONVERSATION];
    return { ...node, extensions };
  });
  return nodes.some((node, index) => node !== hole.nodes[index]) ? { ...hole, nodes } : hole;
}
