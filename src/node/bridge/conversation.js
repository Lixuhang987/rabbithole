import { normalizeCodexConversation } from "../../core/conversation.js";
import { BridgeError } from "./errors.js";

/** Validate the opt-in contract before touching Codex history. */
export function conversationRequest(value, backend, stream) {
  if (value === undefined) return null;
  const fail = () => { throw new BridgeError("Invalid Rabbithole conversation request.", "conversation_invalid", 400); };
  if (!value || typeof value !== "object" || Array.isArray(value) || backend !== "codex") return fail();
  if (value.version !== 1 || !["create", "baseline", "fork"].includes(value.operation)) return fail();
  if (typeof value.nodeId !== "string" || !value.nodeId.trim() || value.nodeId.length > 256) return fail();
  if (Object.keys(value).some((key) => !["version", "operation", "nodeId", "source"].includes(key))) return fail();
  const source = normalizeCodexConversation(value.source);
  if (value.operation === "fork" ? !source : value.source !== undefined) return fail();
  if (value.operation === "baseline" && stream === true) return fail();
  return { version: 1, operation: value.operation, nodeId: value.nodeId, source };
}
