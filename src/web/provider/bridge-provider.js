import { normalizeBackendConversation } from '../../core/conversation.js';
import { selectedVisualSource } from '../../core/prompts/answering-v1.js';
import { ProviderError, normalizeProviderError } from './errors.js';
import { addressSpaceHint } from './network.js';
import { adaptBranchGeneration, adaptTextGeneration } from './generation-events.js';

export function createProvider(settings) {
  return new BridgeProvider({ backend: settings.backend, model: settings.model, reasoning: settings.reasoning,
    baseUrl: settings.base_url, token: settings.token });
}
export class BridgeProvider {
  /** @param {{backend?: string, model?: string, reasoning?: string, baseUrl?: string, token?: string}} [options] */
  constructor({ backend = 'codex', model, reasoning = '', baseUrl, token } = {}) {
    this.backend = backend;
    this.model = model;
    this.reasoning = reasoning;
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.token = token || '';
  }
  async *generate(input, signal, sourceSession) {
    yield* streamBridgeEvents({ url: `${this.baseUrl}/bridge/generate`, token: this.token, signal,
      body: { backend: this.backend, model: this.model, reasoning: this.reasoning,
        ...(sourceSession ? { sourceSession } : {}), input } });
  }
  /** @param {any} source @param {AbortSignal} [signal] @param {{nodeId?:string}} [options] */
  async *authorDocument(source, signal, { nodeId } = {}) {
    const document = Object.fromEntries(['title', 'markdown', 'source_name', 'kind', 'base_url']
      .filter((key) => source[key] != null).map((key) => [key, source[key]]));
    yield* withNode(adaptTextGeneration(this.generate({ kind: 'author', source: document }, signal)), nodeId);
  }
  /** @param {{question?: string, nodeId?:string}} [context] @param {AbortSignal} [signal] */
  async *authorExplainer({ question, nodeId } = {}, signal) {
    yield* withNode(adaptTextGeneration(this.generate({ kind: 'explain', question }, signal)), nodeId);
  }
  async *answerBranch(context, signal) {
    const sourceSession = context.conversation;
    const block = context.anchor?.block?.block_id;
    const input = { kind: 'ask', question: context.question || '', selected_text: context.selected_text || '',
      ...(context.lens ? { lens: context.lens } : {}), ...(context.instruction ? { instruction: context.instruction } : {}),
      ...(block ? { visual_source: selectedVisualSource(context.parent_markdown || '', block) } : {}),
      ...(!sourceSession ? { article: { title: context.parent_title, markdown: context.parent_markdown } } : {}),
      ...(context.attachments?.length ? { attachments: context.attachments } : {}) };
    yield* withNode(adaptBranchGeneration(this.generate(input, signal, sourceSession), { fallbackTitle: context.fallbackTitle }), context.node_id);
  }
}
async function* withNode(events, nodeId) {
  for await (const event of events) {
    if (event.type === 'conversation') {
      if (nodeId) yield { ...event, nodeId };
    } else yield event;
  }
}

/** Native bridge protocol; a validated terminal event is required even for empty text. */
export async function* streamBridgeEvents({ url, token = '', body, signal = undefined }) {
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream',
      Authorization: `Bearer ${token}` }, body: JSON.stringify(body), signal, ...addressSpaceHint(url) });
  } catch (error) { throw normalizeProviderError(error); }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new ProviderError(detail.error?.message || `Bridge returned HTTP ${response.status}.`,
      { status: response.status, code: detail.error?.code || String(response.status) });
  }
  if (!response.body) throw new ProviderError('The bridge did not return a stream.', { code: 'no_stream' });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completion = null;
  function parse(frame) {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) return null;
    let event;
    try { event = JSON.parse(data); } catch { throw new ProviderError('Malformed bridge event.', { code: 'conversation_incomplete' }); }
    if (event.type === 'error') throw new ProviderError(event.message || 'Generation failed.', { code: event.code || 'turn_failed' });
    if (completion) throw new ProviderError('Events arrived after completion.', { code: 'conversation_invalid' });
    if (event.type === 'completed') {
      const session = normalizeBackendConversation(event.session);
      if (!session || session.backend !== body.backend || (body.sourceSession &&
        (session.sessionId === body.sourceSession.sessionId || session.scopeId !== body.sourceSession.scopeId))) {
        throw new ProviderError('Invalid completed session.', { code: 'conversation_invalid' });
      }
      completion = { type: 'conversation', conversation: session };
      return null;
    }
    if (event.type === 'text' && typeof event.delta === 'string') return event;
    if (event.type === 'search' && typeof event.id === 'string' && ['searching', 'completed'].includes(event.status)) return event;
    throw new ProviderError('Invalid bridge event.', { code: 'conversation_invalid' });
  }
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/); buffer = frames.pop() || '';
      for (const frame of frames) { const event = parse(frame); if (event) yield event; }
    }
    buffer += decoder.decode();
    if (buffer.trim()) throw new ProviderError('Truncated bridge event.', { code: 'conversation_incomplete' });
    if (!completion) throw new ProviderError('The bridge did not complete its session.', { code: 'conversation_incomplete' });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    yield completion;
  } catch (error) { throw normalizeProviderError(error); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
