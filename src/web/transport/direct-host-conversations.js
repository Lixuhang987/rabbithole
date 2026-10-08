import { CODEX_CONVERSATION, normalizeCodexConversation } from "../../core/conversation.js";
import { ProviderError } from "../provider/errors.js";

/** Prepare one immutable article baseline; concurrent Asks share preparation only. */
export async function prepareNodeConversation(host, provider, context, signal, { reset = false } = {}) {
  if (!provider.codexConversations) return null;
  const node = host.state.nodes.get(context.parent_id);
  if (!node) throw new ProviderError("The source article is unavailable.", { code: "conversation_invalid" });
  const existing = normalizeCodexConversation(node.extensions?.[CODEX_CONVERSATION]);
  if (!reset && existing && (!provider.conversationScope || existing.scopeId === provider.conversationScope)) return existing;
  let entry = host.conversationBaselines.get(node.id);
  if (!entry || entry.provider !== provider) {
    const controller = new AbortController();
    entry = { provider, controller, users: 0, settled: false, promise: null };
    const active = entry;
    active.promise = provider.createConversation(context, controller.signal).then(
      (reference) => { active.settled = true; return reference; },
      (error) => { active.settled = true; throw error; },
    );
    host.conversationBaselines.set(node.id, active);
  }
  entry.users += 1;
  try {
    const conversation = await waitForBaseline(entry.promise, signal);
    if (signal.aborted || host.disposed) throw new DOMException("Aborted", "AbortError");
    if (!host.state.nodes.has(node.id)) throw new ProviderError("The source article was removed.", { code: "conversation_invalid" });
    const event = { type: "node_extensions_patch", node_id: node.id, namespace: CODEX_CONVERSATION, value: conversation };
    host.dispatch(event);
    host.emit(event);
    await host.flushSave();
    return conversation;
  } finally {
    entry.users -= 1;
    if (!entry.users) {
      if (!entry.settled) entry.controller.abort();
      if (host.conversationBaselines.get(node.id) === entry) host.conversationBaselines.delete(node.id);
    }
  }
}

function waitForBaseline(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
