/** @protects native bridge search failures, cancellation, concurrency and backend availability. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProvider } from '../../src/web/provider/bridge-provider.js';
import { createBridge } from '../../src/node/bridge/server.js';
const root = path.resolve(new URL('../..', import.meta.url).pathname);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'rabbithole-native-failures-'));
const concurrency = path.join(temporary, 'concurrency');
const protocol = path.join(temporary, 'protocol');
const env = { ...process.env, HOME: path.join(temporary, 'home'), RABBITHOLE_DIR: path.join(temporary, 'data'),
  RABBITHOLE_BRIDGE_CODEX_BIN: path.join(root, 'test/integration/fixtures/fake-codex.mjs'),
  FAKE_CODEX_CONCURRENCY: concurrency, FAKE_CODEX_PROTOCOL_RECORD: protocol, RABBITHOLE_BRIDGE_EGO_BIN: path.join(root, 'test/integration/fixtures/fake-ego-browser.mjs') };
await fs.mkdir(path.join(env.HOME, '.codex'), { recursive: true });
await fs.writeFile(path.join(env.HOME, '.codex', 'auth.json'), '{}');
async function collect(iterable) { const events = []; for await (const event of iterable) events.push(event); return events; }
async function waitForFile(file, predicate) {
  const until = Date.now() + 5000;
  while (Date.now() < until) { const value = await fs.readFile(file, 'utf8').catch(() => ''); if (predicate(value)) return value; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error(`File did not reach expected state: ${file}`);
}
let bridge;
let signedOutBridge;
try {
  bridge = await createBridge({ port: 0, env, stateRefreshMs: 60000 });
  await bridge.start(); await bridge.refreshState();
  const provider = createProvider({ backend: 'codex', base_url: bridge.url, token: bridge.token, model: 'gpt-fake', reasoning: 'low' });
  const events = [];
  await assert.rejects(async () => { for await (const event of provider.authorExplainer({ question: 'SEARCH FAIL' })) events.push(event); },
    (/** @type {any} */ error) => error.code === 'web_search_failed');
  assert.deepEqual(events.map((event) => event.status), ['searching']);
  const searchAbort = new AbortController();
  const stream = provider.authorExplainer({ question: 'SEARCH SLOW' }, searchAbort.signal);
  assert.equal((await stream.next()).value.status, 'searching');
  searchAbort.abort();
  await assert.rejects(() => stream.next(), (/** @type {any} */ error) => error.code === 'abort');
  await stream.return(undefined);
  await waitForFile(protocol, (value) => value.includes('turn/interrupt'));
  const abort = new AbortController();
  const slow = collect(provider.authorExplainer({ question: 'SLOW' }, abort.signal)); slow.catch(() => {});
  await waitForFile(concurrency, (value) => Number(value.trim()) >= 1);
  const busy = await fetch(`${bridge.url}/bridge/restart`, { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(busy.status, 409);
  assert.equal((await busy.json()).error.code, 'bridge_busy');
  const completed = await collect(provider.authorExplainer({ question: 'Concurrent request', nodeId: 'parallel' }));
  assert.equal(completed.at(-1).type, 'conversation');
  assert.ok(Number((await fs.readFile(concurrency, 'utf8')).trim()) >= 2);
  abort.abort(); await assert.rejects(slow, (/** @type {any} */ error) => error.code === 'abort');
  signedOutBridge = await createBridge({ port: 0, env: { ...env, RABBITHOLE_DIR: path.join(temporary, 'signedout'), FAKE_CODEX_SIGNED_OUT: '1' }, stateRefreshMs: 60000 });
  await signedOutBridge.start(); await signedOutBridge.refreshState();
  const controller = new AbortController();
  const response = await fetch(`${signedOutBridge.url}/bridge/events`, { headers: { Authorization: `Bearer ${signedOutBridge.token}` }, signal: controller.signal });
  const first = await response.body.getReader().read(); controller.abort();
  const state = JSON.parse(new TextDecoder().decode(first.value).split('\n')[0].slice(6));
  assert.equal(state.agents[0].state, 'signed_out');
  assert.equal(state.agents[0].fix, 'codex login');
  console.log('ok native bridge: search failure, interruption, concurrency and signed-out state');
} finally { await Promise.allSettled([bridge?.close(), signedOutBridge?.close()]); await fs.rm(temporary, { recursive: true, force: true }); }
