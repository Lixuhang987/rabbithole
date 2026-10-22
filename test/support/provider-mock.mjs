import { installStoreRoutes } from './backend-store.mjs';
export const BRIDGE_URL = 'http://127.0.0.1:41414';
export const MOCK_MODEL = 'gpt-fake';
export const MOCK_TOKEN = 'browser-paired-token';
export const MOCK_MODELS = [
  { id: MOCK_MODEL, name: 'Codex Test', images: true, reasoning: { options: ['low', 'medium', 'high'], default: 'medium' } },
  { id: 'gpt-text', name: 'Codex Text', images: false, reasoning: { options: ['medium'], default: 'medium' } },
];
export const MOCK_STATE = { bridge: 'test', agents: [{ id: 'codex', state: 'ready', models: MOCK_MODELS }] };
export function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, accept', 'Access-Control-Allow-Private-Network': 'true' };
}
let sequence = 0;
export function sse(chunks) {
  return [...chunks.map((delta) => ({ type: 'text', delta })),
    { type: 'completed', session: { backend: 'codex', sessionId: `mock-session-${++sequence}`, scopeId: 'mock-scope' } }]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}
/** @param {any} page @param {{streams?: string[][], onProviderCall?: (body:any) => void, providerDelayMs?: number}} [options] */
export async function routeProvider(page, { streams = [], onProviderCall = null, providerDelayMs = 0 } = {}) {
  await installStoreRoutes(page.context());
  // State streams stay open like the real bridge. A closed mock stream causes
  // reconnect churn and makes browser network-idle waits impossible.
  await page.addInitScript(({ bridgeUrl, state }) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== `${bridgeUrl}/bridge/events`) return nativeFetch(input, init);
      const signal = init.signal;
      let detach = () => {};
      const stream = new ReadableStream({
        start(controller) {
          const abort = () => { controller.error(new DOMException('Aborted', 'AbortError')); detach(); };
          detach = () => signal?.removeEventListener('abort', abort);
          if (signal?.aborted) { abort(); return; }
          signal?.addEventListener('abort', abort, { once: true });
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(state)}\n\n`));
        },
        cancel() { detach(); },
      });
      return Promise.resolve(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }));
    };
  }, { bridgeUrl: BRIDGE_URL, state: MOCK_STATE });
  await page.route(`${BRIDGE_URL}/bridge/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: corsHeaders(), body: '' });
    const url = new URL(request.url());
    if (url.pathname.startsWith('/bridge/store/')) return route.fallback();
    if (url.pathname === '/bridge/generate') {
      onProviderCall?.(request.postDataJSON());
      const chunks = streams.shift() || ['# Fallback\n\nFallback streamed document.'];
      if (providerDelayMs) await new Promise((resolve) => setTimeout(resolve, providerDelayMs));
      return route.fulfill({ status: 200, headers: { ...corsHeaders(), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' }, body: sse(chunks) });
    }
    if (url.pathname === '/bridge/events') return route.fulfill({ status: 200,
      headers: { ...corsHeaders(), 'Content-Type': 'text/event-stream' }, body: `data: ${JSON.stringify(MOCK_STATE)}\n\n` });
    const result = url.pathname === '/bridge/models' ? { models: MOCK_MODELS } : { ok: true, state: MOCK_STATE };
    return route.fulfill({ status: 200, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  });
}
export async function seedConfiguredBridge(context) {
  await context.addInitScript(({ model, token, base_url }) => {
    localStorage.setItem('rh-web-settings', JSON.stringify({ backend: 'codex', model, reasoning: 'medium', token, base_url }));
  }, { model: MOCK_MODEL, token: MOCK_TOKEN, base_url: BRIDGE_URL });
}
