/** @protects native bridge requests, independent article sessions, persistence and isolation. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProvider } from '../../src/web/provider/bridge-provider.js';
import { DirectRabbitholeHost, createPendingHoleFromQuestion, createHoleFromMarkdown } from '../../src/web/transport/direct-host.js';
import { createPortableProjection } from '../../src/core/portable-projection.js';
import { createSnapshotProjection } from '../../src/core/snapshot-projection.js';
import { createBridge } from '../../src/node/bridge/server.js';
import { HttpStore } from '../../src/web/store/http-store.js';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rabbithole-native-'));
const home = path.join(tmp, 'home');
const record = path.join(tmp, 'turns.ndjson');
const protocol = path.join(tmp, 'protocol.ndjson');
const launches = path.join(tmp, 'launches.ndjson');
const history = path.join(tmp, 'history.json');
await fs.mkdir(path.join(home, '.codex'), { recursive: true });
await fs.writeFile(path.join(home, '.codex/auth.json'), '{}');
const originalConfig = 'web_search = "cached"\n';
await fs.writeFile(path.join(home, '.codex/config.toml'), originalConfig);
const skill = path.join(home, '.agents/skills/ego-browser/SKILL.md');
await fs.mkdir(path.dirname(skill), { recursive: true });
await fs.writeFile(skill, '---\nname: ego-browser\ndescription: Browse with Ego.\n---\n\nEGO_BROWSER_SKILL_BODY\n');
const env = { ...process.env, HOME: home, CODEX_HOME: undefined, RABBITHOLE_DIR: path.join(tmp, 'data'),
  RABBITHOLE_BRIDGE_CODEX_BIN: path.join(root, 'test/integration/fixtures/fake-codex.mjs'),
  RABBITHOLE_BRIDGE_EGO_BIN: path.join(root, 'test/integration/fixtures/fake-ego-browser.mjs'),
  FAKE_CODEX_RECORD: record, FAKE_CODEX_HISTORY: history, FAKE_CODEX_PROTOCOL_RECORD: protocol,
  FAKE_CODEX_APP_SERVER_ARGS: launches };
const lines = async (file) => (await fs.readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const turns = () => lines(record);
const calls = () => lines(protocol);
/** @type {any} */
let bridge;
const hosts = [];
async function startBridge() {
  bridge = await createBridge({ port: 0, env, version: 'test', stateRefreshMs: 60000 });
  await bridge?.start(); await bridge.refreshState();
}
function settings(model = 'gpt-fake') { return { backend: 'codex', model, reasoning: 'medium', base_url: bridge.url, token: bridge.token }; }
/** @param {string} route @param {any} [options] */
async function request(route, { method = 'GET', body, headers = {}, authenticated = true } = {}) {
  return fetch(bridge.url + route, { method, headers: { ...(authenticated ? { Authorization: `Bearer ${bridge.token}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function generate(input, options = {}) {
  const response = await request('/bridge/generate', { method: 'POST', body: { backend: 'codex', model: 'gpt-fake', reasoning: 'medium', input, ...options } });
  const wire = await response.text();
  if (!response.ok) return { status: response.status, error: JSON.parse(wire).error };
  return { status: response.status, events: wire.split(/\r?\n\r?\n/).filter(Boolean).map((frame) => JSON.parse(frame.slice(6))) };
}
async function waitFor(predicate) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { const result = await predicate(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error('Timed out waiting for native generation');
}
function hostFor(hole, provider = createProvider(settings())) {
  const host = new DirectRabbitholeHost({ hole, provider, store: new HttpStore(settings()) });
  hosts.push(host); return host;
}
async function ask(host, id, parent, question, extra = {}) {
  const result = await host.handleBrowserEvent({ type: 'branch_request', node_id: id, parent_id: parent, question, position: { x: 0, y: 0 }, ...extra });
  assert.equal(result.ok, true);
  return waitFor(() => host.state.nodes.get(id)?.status === 'answered' && host.state.nodes.get(id));
}
try {
  await startBridge();
  assert.equal((await request('/bridge/ping', { authenticated: false })).status, 200);
  assert.equal((await request('/bridge/models', { authenticated: false })).status, 401);
  assert.equal((await request('/bridge/models', { headers: { Origin: 'https://attacker.example' } })).status, 403);
  const models = (await (await request('/bridge/models')).json()).models;
  assert.deepEqual(models.map((model) => model.id), ['gpt-fake', 'gpt-second']);
  const stateResponse = await request('/bridge/events');
  const stateReader = stateResponse.body.getReader();
  const stateText = new TextDecoder().decode((await stateReader.read()).value);
  assert.deepEqual(JSON.parse(stateText.split('data: ')[1].split('\n')[0]).agents.map((agent) => agent.id), ['codex']);
  await stateReader.cancel();

  const large = 'ECHO_LARGE ' + '文'.repeat(6 * 1024 * 1024) + ' ARTICLE_TAIL';
  const echoed = await generate({ kind: 'explain', question: large });
  assert.equal(echoed.status, 200, JSON.stringify(echoed.error));
  assert.ok(echoed.events.filter((event) => event.type === 'text').map((event) => event.delta).join('').includes(large));
  assert.equal(echoed.events.at(-1).type, 'completed');
  assert.equal(echoed.events.at(-1).usage.cachedInputTokens, 5);
  const image = 'data:image/png;base64,AQID';
  const noImages = await generate({ kind: 'ask', question: 'Read this', attachments: [{ kind: 'image', data_url: image }] }, { model: 'gpt-second' });
  assert.equal(noImages.error.code, 'model_no_images');

  const hole = createPendingHoleFromQuestion('SEARCH root context');
  const host = hostFor(hole, createProvider(settings()));
  const progress = []; host.onEvent = (event) => progress.push(event);
  host.startRootAnswer();
  const article = await waitFor(() => host.state.nodes.get(hole.root_id)?.status === 'answered' && host.state.nodes.get(hole.root_id));
  const source = article.extensions.backend_conversation;
  assert.equal(source.backend, 'codex');
  assert.ok(source.sessionId && source.scopeId);
  assert.match(article.markdown, /https:\/\/example.com\/search-result/);
  assert.doesNotMatch(article.markdown, /|I will search now/);
  assert.ok(progress.some((event) => event.type === 'node_search_status' && event.status === 'searching'));
  await host.flushSave();
  const persisted = await new HttpStore(settings()).loadHole(hole.hole_id);
  assert.deepEqual(persisted.nodes[0].extensions.backend_conversation, source);
  const store = { getAsset: async () => null };
  assert.equal((await createPortableProjection(persisted, {})).hole.nodes[0].extensions.backend_conversation, undefined);
  assert.equal((await createSnapshotProjection(persisted, persisted.view_state, {})).hole.nodes[0].extensions.backend_conversation, undefined);
  assert.deepEqual(persisted.nodes[0].extensions.backend_conversation, source);

  const child = await ask(host, 'child', article.id, 'SEARCH branch', { selected_text: 'selected text', lens: 'example', instruction: 'Keep it concrete' });
  const childSession = child.extensions.backend_conversation;
  assert.notEqual(childSession.sessionId, source.sessionId);
  let turn = (await turns()).at(-1);
  assert.match(JSON.stringify(turn.inheritedHistory), /SEARCH root context/);
  assert.match(turn.input[0].text, /selected text|Keep it concrete/);
  assert.ok(!turn.input[0].text.includes(article.markdown));
  const sibling = await ask(host, 'sibling', article.id, 'Independent sibling');
  assert.notEqual(sibling.extensions.backend_conversation.sessionId, childSession.sessionId);
  assert.doesNotMatch(JSON.stringify((await turns()).at(-1).inheritedHistory), /SEARCH branch/);
  await ask(host, 'grandchild', child.id, 'Descendant question');
  assert.equal((await calls()).filter((call) => call.method === 'thread/fork').at(-1).params.threadId, childSession.sessionId);
  await host.flushSave();
  const reopened = hostFor(await new HttpStore(settings()).loadHole(hole.hole_id));
  await ask(reopened, 'reopen', child.id, 'Ask after reopening');
  assert.equal((await calls()).filter((call) => call.method === 'thread/fork').at(-1).params.threadId, childSession.sessionId);

  const importedBody = '# Imported\nUnique imported parent context ' + '文'.repeat(100000);
  const imported = createHoleFromMarkdown({ markdown: importedBody });
  const importedHost = hostFor(imported);
  const beforeImport = (await turns()).length;
  const [first, second] = await Promise.all([
    ask(importedHost, 'import-one', imported.root_id, 'First imported Ask'),
    ask(importedHost, 'import-two', imported.root_id, 'Second imported Ask'),
  ]);
  const importedTurns = (await turns()).slice(beforeImport);
  assert.equal(importedTurns.length, 2);
  for (const importedTurn of importedTurns) {
    assert.deepEqual(importedTurn.inheritedHistory, []);
    assert.ok(importedTurn.input[0].text.includes(importedBody));
  }
  assert.equal(importedHost.state.nodes.get(imported.root_id).extensions.backend_conversation, undefined);
  assert.notEqual(first.extensions.backend_conversation.sessionId, second.extensions.backend_conversation.sessionId);
  await ask(importedHost, 'import-deeper', first.id, 'Follow up on imported answer');
  assert.equal((await calls()).filter((call) => call.method === 'thread/fork').at(-1).params.threadId, first.extensions.backend_conversation.sessionId);

  const presetAnswer = await ask(host, 'preset-only', article.id, '', { lens: 'deeper', instruction: 'Explain the whole article in greater depth.' });
  assert.ok(presetAnswer.extensions.backend_conversation);
  assert.match((await turns()).at(-1).input[0].text, /Explain the whole article in greater depth/);

  const beforeInvalid = (await turns()).length;
  const unavailable = await generate({ kind: 'ask', question: 'Unusable history' }, { sourceSession: { ...source, sessionId: 'missing-history' } });
  assert.equal(unavailable.error.code, 'conversation_unavailable');
  const mismatch = await generate({ kind: 'ask', question: 'Another backend' }, { sourceSession: { ...source, backend: 'claude' } });
  assert.equal(mismatch.error.code, 'backend_mismatch');
  const rescope = await generate({ kind: 'ask', question: 'Another history store' }, { sourceSession: { ...source, scopeId: 'other-store' } });
  assert.equal(rescope.error.code, 'conversation_unavailable');
  assert.equal((await turns()).length, beforeInvalid);

  const errors = []; host.onEvent = (event) => { if (event.type === 'node_error') errors.push(event); };
  await host.handleBrowserEvent({ type: 'branch_request', node_id: 'failed', parent_id: article.id, question: 'SEARCH FAIL ONCE', position: { x: 0, y: 0 } });
  await waitFor(() => errors.length);
  assert.equal(errors.at(-1).code, 'web_search_failed');
  assert.equal(host.state.nodes.get('failed').extensions.backend_conversation, undefined);
  const failedThread = (await turns()).at(-1).threadId;
  host.handleRetry({ node_id: 'failed' });
  const retried = await waitFor(() => host.state.nodes.get('failed')?.status === 'answered' && host.state.nodes.get('failed'));
  assert.notEqual(retried.extensions.backend_conversation.sessionId, failedThread);
  assert.doesNotMatch(JSON.stringify((await turns()).at(-1).inheritedHistory), /SEARCH FAIL ONCE/);
  const beforeCancel = (await turns()).length;
  await host.handleBrowserEvent({ type: 'branch_request', node_id: 'cancelled', parent_id: article.id, question: 'SLOW cancelled', position: { x: 0, y: 0 } });
  await waitFor(async () => (await turns()).length > beforeCancel);
  const cancelledThread = (await turns()).at(-1).threadId;
  await host.handleBrowserEvent({ type: 'delete_node', node_id: 'cancelled' });
  await waitFor(async () => (await calls()).some((call) => call.method === 'turn/interrupt' && call.params.threadId === cancelledThread));
  assert.equal(host.state.nodes.has('cancelled'), false);

  await generate({ kind: 'ask', question: 'Image question', attachments: [{ kind: 'image', data_url: image }] });
  assert.equal((await turns()).at(-1).input.find((part) => part.type === 'image').url, image);
  await generate({ kind: 'ask', attachments: [{ kind: 'image', data_url: image }] });
  assert.equal((await turns()).at(-1).input.find((part) => part.type === 'image').url, image);
  await generate({ kind: 'transcribe', pages: [{ n: 1, data_url: image }], tail: 'previous tail' });
  assert.equal((await turns()).at(-1).model, 'gpt-fake');
  assert.ok((await turns()).at(-1).input[0].text.includes('previous tail'));

  const executions = (await calls()).filter((call) => ['thread/start', 'thread/fork'].includes(call.method));
  for (const call of executions) { assert.equal(call.params.ephemeral, false); assert.equal(call.params.approvalPolicy, 'never'); assert.equal(call.params.sandbox, 'danger-full-access'); }
  for (const call of await turns()) { assert.equal(call.approvalPolicy, 'never'); assert.deepEqual(call.sandboxPolicy, { type: 'dangerFullAccess' }); }
  const launch = (await lines(launches)).find((call) => call.args[0] === 'app-server');
  assert.ok(launch.args.includes('model_context_window=1000000'));
  assert.ok(launch.args.includes('model_auto_compact_token_limit=900000'));
  assert.match(launch.args.find((arg) => arg.startsWith('mcp_servers={')), /rabbithole_ego_browser/);
  assert.match(executions.at(-1).params.developerInstructions, /EGO_BROWSER_SKILL_BODY/);
  assert.equal(await fs.readFile(path.join(home, '.codex/config.toml'), 'utf8'), originalConfig);

  await host.flushSave();
  await bridge?.close(); await startBridge();
  const reloaded = await new HttpStore(settings()).loadHole(hole.hole_id);
  assert.deepEqual(reloaded.nodes.find((node) => node.id === hole.root_id).extensions.backend_conversation, source);
  const restarted = hostFor(reloaded, createProvider(settings('gpt-second')));
  const restartAnswer = await ask(restarted, 'restart', child.id, 'Ask after bridge restart');
  assert.equal(restartAnswer.extensions.backend_conversation.scopeId, source.scopeId);
  assert.equal((await turns()).at(-1).model, 'gpt-second');
  assert.equal((await turns()).at(-1).effort, 'medium');
  assert.match(JSON.stringify((await turns()).at(-1).inheritedHistory), /SEARCH branch/);
  console.log('ok native bridge: create/fork, imported independence, history boundaries, completion, persistence, vision and isolation');
} finally {
  await Promise.allSettled(hosts.map((host) => host.dispose()));
  await bridge?.close(); await fs.rm(tmp, { recursive: true, force: true });
}
