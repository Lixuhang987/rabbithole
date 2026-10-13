/** @protects preferences store capability contracts. */
import assert from "node:assert/strict";

const store = new Map();
let settingsReads = 0;
(/** @type {any} */ (globalThis)).localStorage = {
  getItem: (key) => {
    if (key === "rh-web-settings") settingsReads += 1;
    return store.has(key) ? store.get(key) : null;
  },
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
};

const { loadSettings, saveSettings, resetSettingsCache } = await import("../../src/web/settings/settings.js");
const { takeBridgeTokenFromFragment } = await import("../../src/web/settings/bridge-pairing.js");
const settings = { ...loadSettings(), backend: "codex", model: "gpt-test", reasoning: "high", token: "paired" };
saveSettings(settings);
resetSettingsCache();
assert.deepEqual(loadSettings(), settings);
const readsAfterHydration = settingsReads;
for (let i = 0; i < 20; i += 1) assert.strictEqual(loadSettings(), loadSettings());
assert.equal(settingsReads, readsAfterHydration);
let notifications = 0;
const { subscribeSettings } = await import("../../src/web/settings/settings.js");
const unsubscribe = subscribeSettings(() => notifications++);
saveSettings({ ...settings, reasoning: "low" });
assert.equal(notifications, 1);
unsubscribe();
store.set("rh-web-settings", "not json"); resetSettingsCache();
assert.equal(loadSettings().backend, "codex");
/* Fragment pairing removes only bridge and leaves the remaining hash route intact. */
const pairingLocation = { pathname: "/h/example", search: "?view=canvas", hash: "#route=notes&bridge=fresh-token&tab=2" };
let replacedUrl = "";
const pairingHistory = {
  state: { preserved: true },
  replaceState(state, title, url) {
    assert.deepEqual(state, { preserved: true });
    assert.equal(title, "");
    replacedUrl = url;
  },
};
assert.deepEqual(takeBridgeTokenFromFragment(pairingLocation, pairingHistory), { token: "fresh-token" });
assert.equal(replacedUrl, "/h/example?view=canvas#route=notes&tab=2");

/* A non-default port rides along in the fragment and is stripped with the token. */
const portedLocation = { pathname: "/", search: "", hash: "#bridge=ported-token&bridge_port=41500" };
let portedUrl = "";
const portedHistory = { state: null, replaceState(_state, _title, url) { portedUrl = url; } };
assert.deepEqual(takeBridgeTokenFromFragment(portedLocation, portedHistory), { token: "ported-token", port: 41500 });
assert.equal(portedUrl, "/");
