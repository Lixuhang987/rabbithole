import { normalizeCodexConversation } from "../../core/conversation.js";
import { buildAnswerMessages, buildConversationBaselineMessages } from "../../core/prompts/answering-v1.js";
import { buildAuthorMessages } from "../../core/prompts/authoring-v1.js";
import { buildExplainerMessages } from "../../core/prompts/explainer-v1.js";
import { buildTranscribeMessages } from "../../core/prompts/transcribe-v1.js";
import { ProviderError, normalizeProviderError } from "./errors.js";
import { addressSpaceHint } from "./model-endpoint.js";
import { adaptBranchGeneration, adaptTextGeneration } from "./generation-events.js";
import { providerFor } from "./provider-registry.js";

export function createProvider(settings, apiKey) {
  const preset = providerFor(settings?.preset);
  const model = settings?.model || preset.model;
  return new OpenAICompatibleProvider({
    baseUrl: settings?.base_url || preset.base_url,
    apiKey,
    model,
    transcribeModel: settings?.transcribe_model || preset.transcribe_model || model,
    reasoningEffort: settings?.reasoning || "",
    codexConversations: preset.id === "subscriptions" && model.startsWith("codex/"),
  });
}

export class OpenAICompatibleProvider {
  /** @param {any} [options] */
  constructor({ baseUrl, apiKey, model, transcribeModel, reasoningEffort = "", extraHeaders = {}, title = "Rabbithole", codexConversations = false } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey || "";
    this.model = model || "anthropic/claude-sonnet-5";
    this.transcribeModel = transcribeModel || this.model;
    this.reasoningEffort = reasoningEffort || "";
    this.extraHeaders = extraHeaders || {};
    this.title = title;
    this.codexConversations = codexConversations;
    this.conversationScope = null;
  }

  tuning() {
    return this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {};
  }

  conversationOptions(operation, nodeId, source = undefined) {
    if (!this.codexConversations || !nodeId) return {};
    return { rabbithole_conversation: { version: 1, operation, nodeId, ...(source ? { source } : {}) } };
  }

  async createConversation(context, signal) {
    const body = {
      model: this.model, messages: buildConversationBaselineMessages(context), stream: false,
      ...this.tuning(), ...this.conversationOptions("baseline", context.parent_id),
    };
    const response = await fetchOpenAIResponse({ url: chatCompletionsUrl(this.baseUrl), apiKey: this.apiKey, body, signal, extraHeaders: this.extraHeaders, title: this.title });
    const result = (await response.json()).rabbithole_conversation;
    const conversation = normalizeCodexConversation(result?.conversation);
    if (!conversation || result?.nodeId !== context.parent_id) throw new ProviderError("Codex did not return the article's conversation.", { code: "conversation_invalid" });
    this.conversationScope = conversation.scopeId;
    return conversation;
  }

  /** @param {any} source @param {AbortSignal} [signal] @param {{nodeId?: string}} [options] */
  async *authorDocument(source, signal, { nodeId } = {}) {
    const body = {
      model: this.model,
      messages: buildAuthorMessages(source),
      ...this.conversationOptions("create", nodeId),
      stream: true,
      temperature: 0.2,
      ...this.tuning(),
    };
    yield* adaptTextGeneration(streamOpenAIEvents({
      url: chatCompletionsUrl(this.baseUrl),
      apiKey: this.apiKey,
      body,
      signal,
      extraHeaders: this.extraHeaders,
      title: this.title,
    }));
  }

  /** @param {{question?: string, nodeId?: string}} [input] @param {AbortSignal} [signal] */
  async *authorExplainer({ question, nodeId } = {}, signal) {
    const body = {
      model: this.model,
      messages: buildExplainerMessages({ question }),
      ...this.conversationOptions("create", nodeId),
      stream: true,
      temperature: 0.35,
      ...this.tuning(),
    };
    yield* adaptTextGeneration(streamOpenAIEvents({
      url: chatCompletionsUrl(this.baseUrl),
      apiKey: this.apiKey,
      body,
      signal,
      extraHeaders: this.extraHeaders,
      title: this.title,
    }));
  }

  async *answerBranch(context, signal) {
    const body = {
      model: this.model,
      messages: buildAnswerMessages(context, { incremental: this.codexConversations && !!context?.node_id }),
      ...this.conversationOptions("fork", context?.node_id, context?.conversation),
      stream: true,
      temperature: 0.4,
      ...this.tuning(),
    };
    yield* adaptBranchGeneration(streamOpenAIEvents({
      url: chatCompletionsUrl(this.baseUrl),
      apiKey: this.apiKey,
      body,
      signal,
      extraHeaders: this.extraHeaders,
      title: this.title,
    }), { fallbackTitle: context?.fallbackTitle });
  }

  async *transcribePages(input, signal) {
    yield* adaptTextGeneration(streamOpenAIEvents({
      url: chatCompletionsUrl(this.baseUrl), apiKey: this.apiKey,
      body: { model: this.transcribeModel, messages: buildTranscribeMessages(input), stream: true, temperature: 0.1, ...this.tuning() },
      signal, extraHeaders: this.extraHeaders, title: this.title,
    }));
  }
}

/**
 * @param {{
 *   url: string,
 *   apiKey?: string,
 *   body: any,
 *   signal?: AbortSignal,
 *   extraHeaders?: Record<string, string>,
 *   title?: string,
 * }} options
 */
export async function* streamOpenAICompatible(options) {
  for await (const event of streamOpenAIEvents(options)) {
    if (event.type === "text") yield event.delta;
  }
}

async function fetchOpenAIResponse({ url, apiKey = "", body, signal = undefined, extraHeaders = {}, title = "Rabbithole" }) {
  let response;
  try {
    /** @type {Record<string, string>} */
    const headers = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...extraHeaders,
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (url.startsWith("https://openrouter.ai/")) {
      headers["HTTP-Referer"] = globalThis.location?.origin || "https://rabbithole.ing";
      headers["X-Title"] = title;
    }
    // Discovery reached this endpoint the same way; generation has to declare the same
    // address space or the model list would load and every answer would fail.
    response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal, ...addressSpaceHint(url) });
  } catch (err) {
    throw normalizeProviderError(err);
  }
  if (!response.ok) throw await responseError(response);
  if (!response.body) throw new ProviderError("The provider did not return a stream.", { code: "no_stream" });

  return response;
}

export async function* streamOpenAIEvents(options) {
  const response = await fetchOpenAIResponse(options);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const expected = options.body.rabbithole_conversation;
  let buffer = "";
  let conversation = null;
  let completed = false;
  let done = false;
  function* eventsOf(raw) {
    for (const event of parseOpenAISseEvents(raw)) {
      if (event.type === "done") { done = true; continue; }
      if (event.type === "finish") { completed = true; continue; }
      if (event.type === "conversation") {
        if (expected) {
          if (event.nodeId !== expected.nodeId) throw new ProviderError("Codex returned a conversation for another article.", { code: "conversation_invalid" });
          conversation = event;
        }
        continue;
      }
      yield event;
    }
  }
  try {
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";
      for (const event of events) yield* eventsOf(event);
    }
    buffer += decoder.decode();
    if (!done && buffer) yield* eventsOf(buffer);
    if (expected) {
      if (!done || !completed || !conversation) throw new ProviderError("Codex did not complete the article's conversation. Try again.", { code: "conversation_incomplete" });
      yield conversation;
    }
  } catch (err) {
    throw normalizeProviderError(err);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function parseOpenAISseEvent(eventText) {
  return parseOpenAISseEvents(eventText).filter((event) => event.type === "text").map((event) => event.delta).join("");
}

function parseOpenAISseEvents(eventText) {
  const lines = String(eventText || "").split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trimStart();
    if (!data) continue;
    if (data === "[DONE]") { out.push({ type: "done" }); continue; }
    let json;
    try { json = JSON.parse(data); } catch { continue; }
    if (json.error) throw new ProviderError(json.error.message || "The provider returned an error.", { code: json.error.code || "provider_error" });
    if (json.object === "rabbithole.search" && ["searching", "completed"].includes(json.status) && typeof json.id === "string") {
      out.push({ type: "search", id: json.id, status: json.status, action: json.action, query: json.query });
      continue;
    }
    if (json.object === "rabbithole.conversation") {
      const conversation = normalizeCodexConversation(json.conversation);
      if (!conversation || typeof json.nodeId !== "string") throw new ProviderError("Invalid Codex conversation metadata.", { code: "conversation_invalid" });
      out.push({ type: "conversation", nodeId: json.nodeId, conversation });
      continue;
    }
    if (json.choices?.some((choice) => choice.finish_reason != null)) out.push({ type: "finish" });
    const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || "";
    if (delta) out.push({ type: "text", delta });
  }
  return out;
}

async function responseError(response) {
  let detail = "";
  let providerCode = "";
  try {
    const text = await response.text();
    if (text) {
      try {
        const json = JSON.parse(text);
        detail = json.error?.message || json.message || "";
        providerCode = json.error?.code || json.code || "";
      } catch {
        detail = text.slice(0, 180);
      }
    }
  } catch {}
  const status = response.status;
  const prefix = status === 401 ? "Bad or missing API key"
    : status === 429 ? "Rate limited by the provider"
      : `Provider returned HTTP ${status}`;
  const bridgeFailure = [
    "unauthorized",
    "agent_signed_out",
    "agent_missing",
    "model_unknown",
    "model_no_images",
    "payload_too_large",
    "turn_failed",
    "web_search_failed",
    "conversation_unavailable",
    "conversation_invalid",
  ].includes(providerCode);
  return new ProviderError(bridgeFailure && detail ? detail : detail ? `${prefix}: ${detail}` : prefix, {
    status,
    code: providerCode || String(status),
    retryable: status !== 401 && status !== 403,
  });
}

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!value) throw new ProviderError("A provider base URL is required.", { code: "missing_base_url", retryable: false });
  return value;
}

function chatCompletionsUrl(baseUrl) {
  return /\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
}
