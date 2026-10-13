/** Machine-local backend history references; never part of portable documents. */
export const BACKEND_CONVERSATION = "backend_conversation";
/** @typedef {{backend: string, sessionId: string, scopeId: string}} BackendConversation */
/** @param {unknown} value @returns {BackendConversation | null} */
export function normalizeBackendConversation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = /** @type {Record<string, unknown>} */ (value);
  const identifier = (/** @type {unknown} */ value) => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
  if (!identifier(raw.backend) || !identifier(raw.sessionId) || !identifier(raw.scopeId)) return null;
  return { backend: String(raw.backend), sessionId: String(raw.sessionId), scopeId: String(raw.scopeId) };
}
/** @param {import("./contracts/artifact.js").PersistedHole} hole */
export function withoutLocalConversations(hole) {
  if (!Array.isArray(hole.nodes)) return hole;
  const nodes = hole.nodes.map((node) => {
    if (!node?.extensions || !Object.hasOwn(node.extensions, BACKEND_CONVERSATION)) return node;
    const extensions = { ...node.extensions };
    delete extensions[BACKEND_CONVERSATION];
    return { ...node, extensions };
  });
  return nodes.some((node, index) => node !== hole.nodes[index]) ? { ...hole, nodes } : hole;
}
