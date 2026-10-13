/** @protects the Codex ego-browser skill's executable MCP adapter and reference/image round trips. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-ego-test-"));
const skill = path.join(temporaryRoot, "ego-browser/SKILL.md");
await fs.mkdir(path.join(path.dirname(skill), "references"), { recursive: true });
await fs.writeFile(skill, "---\nname: ego-browser\ndescription: Browser skill.\n---\nBrowser instructions.");
await fs.writeFile(path.join(path.dirname(skill), "references/api.md"), "Ego API reference.");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "src/node/bridge/agents/ego-browser-mcp.js"), path.join(root, "test/integration/fixtures/fake-ego-browser.mjs"), skill],
  stderr: "pipe",
});
const client = new Client({ name: "ego-adapter-test", version: "1" });
try {
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name), ["ego_browser"]);
  const call = (arguments_) => client.callTool({ name: "ego_browser", arguments: arguments_ });
  const script = "console.log('Ego round completed');";
  const run = await call({ action: "run", script });
  assert.equal(run.isError, undefined);
  assert.match(run.content[0].text, /Ego round completed/);
  const reference = await call({ action: "read_reference", path: "references/api.md" });
  assert.equal(reference.content[0].text, "Ego API reference.");
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  await call({ action: "run", script: `const fs = await import("node:fs/promises"); await fs.writeFile("shot.png", Buffer.from("${png}", "base64"));` });
  const image = await call({ action: "view_image", path: "shot.png" });
  assert.equal(image.content[0].type, "image");
  assert.equal(image.content[0].mimeType, "image/png");
  assert.equal(image.content[0].data, png);
  const failed = await call({ action: "run", script: "throw new Error('browser unavailable');" });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /browser unavailable/);
  process.stdout.write("ego-browser MCP: one tool; script, reference and screenshot round trips verified\n");
} finally {
  await client.close();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
