/** @protects local frontend development serves complete builds and reloads after source edits and build recovery. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startDevServer } from "../../scripts/dev.mjs";

test("local dev serves and reloads successful builds while retaining the last good build", { timeout: 120_000 }, async () => {
  const root = path.resolve(new URL("../..", import.meta.url).pathname);
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-dev-test-"));
  let dev;
  const controller = new AbortController();
  try {
    for (const name of ["src", "policy", "scripts", "build.mjs", "package.json"]) {
      await fs.cp(path.join(root, name), path.join(workspace, name), { recursive: true });
    }
    await fs.symlink(path.join(root, "node_modules"), path.join(workspace, "node_modules"), "dir");
    const messages = [];
    dev = await startDevServer({ rootDir: workspace, port: 0, pollInterval: 50, log: (message) => messages.push(message) });
    const get = (name) => fetch(`${dev.url}${name}`);
    const entry = await get("/");
    assert.equal(entry.headers.get("cache-control"), "no-store");
    const html = await entry.text();
    assert.match(html, /src="\/__dev\/reload.js"/);
    assert.match(await (await get("/__dev/reload.js")).text(), /EventSource/);
    assert.match(await (await get("/library/document")).text(), /<title>Rabbithole/);
    assert.equal((await get("/missing.js")).status, 404);
    assert.equal((await get("/package.json")).status, 404);
    const app = html.match(/src="\.\/(app.js\?[^" ]+)"/)[1];
    const appResponse = await get(`/${app}`);
    assert.match(appResponse.headers.get("content-type"), /javascript/);
    const originalApp = await appResponse.text();
    const oldChunk = originalApp.match(/\.\/chunks\/settings-runtime-[^"']+\.js/)[0].slice(2);

    const stream = await fetch(`${dev.url}/__dev/events`, { signal: controller.signal });
    const reader = stream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    async function nextBuild() {
      while (!buffer.includes("\n\n")) {
        const { value, done } = await reader.read();
        assert.equal(done, false);
        buffer += decoder.decode(value, { stream: true });
      }
      const end = buffer.indexOf("\n\n");
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      return event.match(/data: (.+)/)[1];
    }
    const initial = await nextBuild();
    const cssPath = path.join(workspace, "src/design/tokens.css");
    await fs.appendFile(path.join(workspace, "src/web/settings/model-settings.js"), "\n/* dev chunk update */\n");
    await fs.appendFile(cssPath, "\nbody { --dev-server-test: 1; }\n");
    assert.notEqual(await nextBuild(), initial);
    const goodCss = await (await get("/styles.css")).text();
    assert.match(goodCss, /--dev-server-test:\s*1/);
    assert.equal((await (await get("/app.js")).text()).includes(oldChunk), false, "the edit publishes a new lazy chunk");
    assert.equal((await get(`/${oldChunk}`)).status, 200, "open pages retain access to previous chunks");

    const entryPath = path.join(workspace, "src/web/main.js");
    const source = await fs.readFile(entryPath, "utf8");
    await fs.writeFile(entryPath, `${source}\nexport const =;\n`);
    await waitFor(() => messages.some((message) => message.includes("Build failed")));
    assert.equal(await (await get("/styles.css")).text(), goodCss);
    await fs.writeFile(entryPath, source);
    await fs.appendFile(cssPath, "\nbody { --dev-server-test: 2; }\n");
    await nextBuild();
    assert.match(await (await get("/styles.css")).text(), /--dev-server-test:\s*2/);
  } finally {
    controller.abort();
    await dev?.close();
    await fs.rm(workspace, { recursive: true, force: true });
  }
});

async function waitFor(check) {
  const deadline = Date.now() + 30_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for build failure");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
