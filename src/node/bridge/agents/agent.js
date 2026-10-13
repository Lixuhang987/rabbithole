import { readyAgent, unavailableAgent } from "../state.js";

/** Normalizes native token counters for completion metadata. */
export function tokenUsage(usage) {
  if (!usage || typeof usage !== "object") return undefined;
  const prompt = Number(usage.inputTokens ?? usage.input_tokens) || 0;
  const completion = Number(usage.outputTokens ?? usage.output_tokens) || 0;
  return {
    inputTokens: prompt,
    outputTokens: completion,
    totalTokens: Number(usage.totalTokens ?? usage.total_tokens) || prompt + completion,
  };
}

/** Shared availability/catalog probe; adapters can allow account-free local providers. */
export async function probeAgent({ name, executable, installFix, loginFix, errorFix, status, models }) {
  if (!executable) return unavailableAgent(name, "missing", installFix);
  try {
    const current = await status();
    if (current.requiresLogin ?? !current.signedIn) return unavailableAgent(name, "signed_out", loginFix);
    const catalog = await models();
    if (!catalog.length) return unavailableAgent(name, "error", errorFix, "Empty model catalog");
    return readyAgent(name, { plan: current.plan, models: catalog });
  } catch (error) {
    if (error?.code === "agent_signed_out") return unavailableAgent(name, "signed_out", loginFix);
    return unavailableAgent(name, "error", errorFix, "Model discovery failed");
  }
}
