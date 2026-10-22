/** @protects CLI bridge process restart, fresh source loading, pairing and native fork history. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProvider } from '../../src/web/provider/bridge-provider.js';
import { consumeBridgeEvents, restartBridge } from '../../src/web/provider/bridge-catalog.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'rabbithole-process-restart-'));
const checkout = path.join(temporary, 'checkout');
const env = { ...process.env, HOME: path.join(temporary, 'home'), CODEX_HOME: path.join(temporary, 'home/.codex'),
  RABBITHOLE_DIR: path.join(temporary, 'data'), RABBITHOLE_BRIDGE_CODEX_BIN: path.join(root, 'test/integration/fixtures/fake-codex.mjs'),
  RABBITHOLE_BRIDGE_EGO_BIN: path.join(root, 'test/integration/fixtures/fake-ego-browser.mjs'),
  FAKE_CODEX_HISTORY: path.join(temporary, 'history.json') };
let child;
let output = '';
async function until(read, predicate) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Bridge lifecycle did not reach expected state');
}
async function ready(url, token) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  /** @type {any} */ let state;
  try {
    await consumeBridgeEvents(url, token, { signal: controller.signal, onState(next) {
      if (next.agents[0]?.state === 'ready') { state = next; controller.abort(); }
    } });
  } catch (error) { if (!state) throw error; }
  finally { clearTimeout(timer); }
  assert.ok(state);
  return state;
}
async function collect(stream) { const events = []; for await (const event of stream) events.push(event); return events; }
try {
  await fs.mkdir(checkout);
  await Promise.all(['src', 'bin'].map((dir) => fs.cp(path.join(root, dir), path.join(checkout, dir), { recursive: true })));
  await fs.copyFile(path.join(root, 'package.json'), path.join(checkout, 'package.json'));
  await fs.symlink(path.join(root, 'node_modules'), path.join(checkout, 'node_modules'), 'dir');
  await fs.mkdir(env.CODEX_HOME, { recursive: true });
  await fs.writeFile(path.join(env.CODEX_HOME, 'auth.json'), '{}');
  child = spawn(process.execPath, [path.join(checkout, 'bin/rabbithole.js'), 'bridge', '--port', '0', '--no-open', '--new-token'],
    { cwd: checkout, env, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => { output += chunk; });
  await until(() => output, (value) => /Pairing token: ([a-f0-9]{64})/.test(value));
  const port = Number(/listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(output)[1]);
  const token = /Pairing token: ([a-f0-9]{64})/.exec(output)[1];
  const url = `http://127.0.0.1:${port}`;
  const before = await ready(url, token);
  const provider = createProvider({ backend: 'codex', base_url: url, token, model: 'gpt-fake', reasoning: 'low' });
  const rootEvents = await collect(provider.authorExplainer({ question: 'A root article before restart', nodeId: 'root' }));
  const sourceSession = rootEvents.at(-1).conversation;
  assert.ok(sourceSession);
  const source = path.join(checkout, 'src/node/bridge/main.js');
  await fs.writeFile(source, (await fs.readFile(source, 'utf8')).replace('const BRIDGE_VERSION = "0.4.0";', 'const BRIDGE_VERSION = "fresh-source";'));
  const next = await restartBridge(url, token);
  assert.equal(next.bridge, 'fresh-source', 'Restart Bridge must import changed source from disk');
  assert.notEqual(next.instanceId, before.instanceId, 'the HTTP-serving process must be replaced');
  assert.equal(await fs.readFile(path.join(env.RABBITHOLE_DIR, 'bridge-token'), 'utf8').then((text) => text.trim()), token);
  const childEvents = await collect(provider.answerBranch({ question: 'Continue after process restart', selected_text: 'root', conversation: sourceSession, node_id: 'child' }));
  const childSession = childEvents.find((event) => event.type === 'conversation')?.conversation;
  assert.equal(childSession.scopeId, sourceSession.scopeId);
  assert.notEqual(childSession.sessionId, sourceSession.sessionId);
  const again = await restartBridge(url, token);
  assert.notEqual(again.instanceId, next.instanceId);
  const pids = [...output.matchAll(/listening on http:\/\/127\.0\.0\.1:\d+ \(pid (\d+)\)/g)].map((match) => match[1]);
  assert.equal(new Set(pids).size, 3, 'each restart must use a new bridge PID');
  const exited = once(child, 'exit'); child.kill('SIGTERM');
  assert.deepEqual(await exited, [0, null]);
  assert.equal(await fetch(url + '/bridge/ping').then(() => true, () => false), false);
  child = undefined;
  console.log('ok bridge restart: fresh source, three PIDs, stable port/token, native fork and graceful stop');
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  }
  await fs.rm(temporary, { recursive: true, force: true });
}
