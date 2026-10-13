/** @protects bridge connection capability contracts. */
import assert from "node:assert/strict";
import { createBridgeConnection } from "../../src/web/settings/bridge-connection.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const listeners = new Map();
const documentRef = {
  hidden: false,
  addEventListener(type, listener) { listeners.set(type, listener); },
  removeEventListener(type, listener) {
    if (listeners.get(type) === listener) listeners.delete(type);
  },
};
let nextTimer = 1;
const timers = new Map();
const timerDelays = [];
const microtasks = [];
const streams = [];
const views = [];
const states = [];
const probes = [];
let unauthorized = 0;
let disconnected = 0;
let probeWanted = false;
const pingResults = [];
const settings = { preset: "subscriptions", base_url: "http://bridge", token: "paired" };

const connection = createBridgeConnection({
  loadSettings: () => settings,
  isConfigured: (value) => value.preset === "subscriptions",
  consumeEvents: (_url, _token, options) => {
    const turn = deferred();
    streams.push({ ...turn, options });
    return turn.promise;
  },
  ping: async () => pingResults.shift() ?? false,
  nextDelay: (delay) => delay ? Math.min(delay * 2, 15_000) : 1_000,
  pingInterval: 5_000,
  probeWanted: () => probeWanted,
  reconnectFromProbe: () => true,
  onState: (state) => states.push(state),
  onView: (view) => views.push(view),
  onDisconnected: () => { disconnected += 1; },
  onUnauthorized: () => { unauthorized += 1; },
  onProbeChange: (up) => probes.push(up),
  documentRef,
  setTimeoutFn(callback, delay) {
    const id = nextTimer++;
    timers.set(id, {
      delay,
      callback() {
        timers.delete(id);
        callback();
      },
    });
    timerDelays.push(delay);
    return id;
  },
  clearTimeoutFn(id) { timers.delete(id); },
  queueMicrotaskFn(callback) { microtasks.push(callback); },
});

connection.start();
assert.deepEqual(views, ["starting"]);
assert.equal(streams.length, 1);
assert.equal(connection.snapshot().connected, true);
streams[0].options.onState({ bridge: "ready" });
assert.deepEqual(states, [{ bridge: "ready" }]);

streams[0].resolve({ reason: "closed" });
await Promise.resolve();
assert.equal(disconnected, 1);
assert.equal(connection.snapshot().reconnectPending, true);
assert.equal(connection.snapshot().immediateReconnectAvailable, false);
assert.deepEqual(views, ["starting", "bridge_down"]);
microtasks.shift()();
assert.equal(streams.length, 2, "the first disconnect reconnects immediately once");

streams[1].resolve({ reason: "closed" });
await Promise.resolve();
assert.equal(connection.snapshot().reconnectDelay, 1_000);
assert.equal(timerDelays.at(-1), 1_000, "later disconnects use bounded backoff");
documentRef.hidden = true;
listeners.get("visibilitychange")();
assert.equal(timers.size, 0, "a hidden page suspends a pending reconnect timer");
documentRef.hidden = false;
listeners.get("visibilitychange")();
assert.equal(streams.length, 3, "visibility resumes the pending reconnect");

streams[2].resolve({ reason: "unauthorized" });
await Promise.resolve();
assert.equal(unauthorized, 1);
assert.equal(connection.snapshot().streamKey, "");
assert.equal(listeners.has("visibilitychange"), false);
assert.equal(views.at(-1), "re_pair");

probeWanted = true;
pingResults.push(true);
connection.syncProbe();
const immediateProbe = [...timers.values()].find((timer) => timer.delay === 0);
assert.ok(immediateProbe);
immediateProbe.callback();
await Promise.resolve();
assert.equal(connection.snapshot().probeUp, true);
assert.deepEqual(probes, [true]);
assert.equal(timerDelays.at(-1), 5_000);

pingResults.push(false);
const scheduledProbe = [...timers.values()].find((timer) => timer.delay === 5_000);
scheduledProbe.callback();
connection.stopProbe();
await Promise.resolve();
assert.equal(connection.snapshot().probeUp, false);
assert.deepEqual(probes, [true, false], "stopped generations cannot publish a stale probe result");

connection.dispose();
assert.equal(timers.size, 0);
process.stdout.write("bridge connection ownership and reconnect/probe lifecycle ok\n");
