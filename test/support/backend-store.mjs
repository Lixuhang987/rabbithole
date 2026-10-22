import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBridge } from "../../src/node/bridge/server.js";
import { HttpStore } from "../../src/web/store/http-store.js";
import { after } from "node:test";

const root = path.resolve(new URL("../..", import.meta.url).pathname);
const contextStores = new WeakMap();
const fixtures = new Set();
after(async () => { await Promise.all([...fixtures].map((fixture) => fixture.close())); });

/** Provider mocks forward document requests to real authenticated loopback storage. */
export async function installStoreRoutes(context, existing = null) {
  if (contextStores.has(context)) return contextStores.get(context);
  const fixture = existing || await createStoreFixture();
  if (!existing) fixtures.add(fixture);
  contextStores.set(context, fixture);
  await context.route("**/bridge/store/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const response = await route.fetch({ url: `${fixture.bridge.url}${url.pathname}${url.search}`,
      headers: { ...request.headers(), host: new URL(fixture.bridge.url).host, authorization: `Bearer ${fixture.bridge.token}` } });
    await route.fulfill({ response });
  });
  context.on("close", () => {
    if (!existing) { fixtures.delete(fixture); void fixture.close(); }
  });
  return fixture;
}

/** Pair UI-only journeys with a disposable backend, without model-response mocks. */
export async function seedStorageBridge(context) {
  const fixture = await installStoreRoutes(context);
  await context.addInitScript((settings) => {
    localStorage.setItem("rh-web-settings", JSON.stringify(settings));
    // UI-only journeys exercise storage even when Codex is signed out and no
    // model is selected. Keep the state stream in-process for network-idle waits.
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== `${settings.base_url}/bridge/events`) return nativeFetch(input, init);
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ bridge: "test", agents: [{ id: "codex", state: "signed_out", models: [] }] })}\n\n`));
        init.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      } }), { headers: { "Content-Type": "text/event-stream" } }));
    };
  }, { backend: "codex", base_url: fixture.bridge.url, token: fixture.bridge.token, model: "", reasoning: "medium" });
  return fixture;
}

export async function createStoreFixture() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-storage-"));
  const directory = path.join(temporary, "data");
  const env = { ...process.env, HOME: path.join(temporary, "home"), CODEX_HOME: path.join(temporary, "home/.codex"),
    RABBITHOLE_DIR: directory,
    RABBITHOLE_BRIDGE_CODEX_BIN: path.join(root, "test/integration/fixtures/fake-codex.mjs"),
    RABBITHOLE_BRIDGE_EGO_BIN: path.join(root, "test/integration/fixtures/fake-ego-browser.mjs"),
    FAKE_CODEX_HISTORY: path.join(temporary, "history.json"),
  };
  await fs.mkdir(env.CODEX_HOME, { recursive: true });
  await fs.writeFile(path.join(env.CODEX_HOME, "auth.json"), "{}");
  let bridge;
  async function start() {
    bridge = await createBridge({ port: 0, env, stateRefreshMs: 60_000 });
    await bridge.start();
    return new HttpStore({ base_url: bridge.url, token: bridge.token });
  }
  const store = await start();
  return { directory, env, store, get bridge() { return bridge; },
    async restart() { await bridge.close(); return start(); },
    async close() { await bridge.close(); await fs.rm(temporary, { recursive: true, force: true }); },
  };
}
