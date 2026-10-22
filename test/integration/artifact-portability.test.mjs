/** @protects artifact portability capability contracts. */
import { seedStorageBridge } from "../support/backend-store.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { ensureWebDist } from "../support/build.mjs";
import { serveStatic } from "../support/static-server.mjs";
import { MOCK_TOKEN, MOCK_MODEL, routeProvider, seedConfiguredBridge } from "../support/provider-mock.mjs";
import { readAttentionPdf } from "../support/attention-pdf.mjs";

const ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const WEB_DIST = path.join(ROOT, "web/dist");
try {
  await fs.access(path.join(WEB_DIST, "index.html"));
} catch {
  try { ensureWebDist(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exit(1); }
}

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-artifact-portability-"));
const server = await serveStatic(WEB_DIST, { spaFallback: true });
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  let authorCalls = 0;
  await seedConfiguredBridge(context);
  await routeProvider(page, {
    streams: [["# Authored Structure\n\n", "This document was streamed through the model.\n\n", "```js\nconsole.log('authored');\n```"]],
    onProviderCall(body) {
      authorCalls += 1;
      assert.equal(body.model, MOCK_MODEL);
      assert.equal(body.input.kind, "author");
      assert.match(body.input.source.markdown, /raw notes about a streamed authoring pass/);
    },
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await assertShellPolish(page);
  await page.click("#t-settings");
  await page.click('[data-settings-section="model"]');
  await page.waitForSelector("#bridge-model");
  await page.click("#complete-model-setup");
  await page.waitForSelector("#settings-sheet", { state: "detached" });

  await page.evaluate(() => window.__rabbitholeTest.createDocument(
    "# Author Check\n\nraw notes about a streamed authoring pass",
    { improveStructure: true },
  ));
  await waitForCanvasText(page, "This document was streamed through the model");
  assert.equal(authorCalls, 1, "Improve structure should call authorDocument once");

  await page.click("#t-new");

  const pdfBytes = await readAttentionPdf();
  await dropPdf(page, pdfBytes);
  await page.waitForSelector(".card .doc-content.rh-pdf .rh-pdf-page[data-page='1']");
  await page.waitForFunction(() => {
    const canvas = document.querySelector(".card .rh-pdf-canvas-generation canvas");
    return !!canvas && canvas.width > 0 && canvas.height > 0;
  });

  const original = await page.evaluate(async () => {
    const holeId = window.__rabbitholeTest.currentHoleId();
    const raw = await window.__rabbitholeTest.readStoredHole(holeId);
    const { names: assets, sizes } = await window.__rabbitholeTest.inspectAssets(holeId);
    return { holeId, raw, assets, sizes };
  });
  assert.equal(original.assets.length, 1);
  assert.match(original.assets[0], /^pdf-[a-f0-9]{64}\.pdf$/);
  assert.equal(original.sizes[original.assets[0]], pdfBytes.length, "portable PDF source must retain exact byte length");

  const shareDownloadPromise = page.waitForEvent("download");
  await page.click("#t-share");
  await page.click("#sm-portable");
  const shareDownload = await shareDownloadPromise;
  const shareExportPath = path.join(tmp, shareDownload.suggestedFilename());
  await shareDownload.saveAs(shareExportPath);
  assert.equal(path.extname(shareExportPath), ".rabbithole");

  const exportText = await fs.readFile(shareExportPath, "utf8");
  assert(!exportText.includes(MOCK_TOKEN), "share .rabbithole export must not contain bridge pairing material");
  const exported = JSON.parse(exportText);
  assert.equal(exported.format, "rabbithole");
  assert.equal(exported.format_version, 1);
  assert.equal(exported.hole.schema_version, 2);
  assert.equal(typeof exported.assets[original.assets[0]], "string");
  assert.equal(Buffer.from(exported.assets[original.assets[0]], "base64").equals(Buffer.from(pdfBytes)), true, "portable export must preserve the original PDF bytes exactly");

  await ensureRailOpen(page);
  assert.equal(await page.locator(".rail-export").count(), 0, "sidebar rows should reserve their full width for titles");

  const fresh = await browser.newContext({ acceptDownloads: true });
  await seedStorageBridge(fresh);
  const importPage = await fresh.newPage();
  await importPage.goto(baseUrl, { waitUntil: "networkidle" });
  await importPage.setInputFiles("#file-md", shareExportPath);
  await importPage.waitForSelector(".card .doc-content.rh-pdf .rh-pdf-page[data-page='1']");
  await importPage.waitForFunction(() => {
    const canvas = document.querySelector(".card .rh-pdf-canvas-generation canvas");
    return !!canvas && canvas.width > 0 && canvas.height > 0;
  });

  const imported = await importPage.evaluate(async () => {
    const holeId = window.__rabbitholeTest.currentHoleId();
    const raw = await window.__rabbitholeTest.readStoredHole(holeId);
    const { names: assets, sizes } = await window.__rabbitholeTest.inspectAssets(holeId);
    return { holeId, raw, assets, sizes };
  });
  assert.deepEqual(projectHole(imported.raw), projectHole(original.raw));
  assert.deepEqual(imported.assets, original.assets);
  assert.equal(imported.sizes[original.assets[0]], original.sizes[original.assets[0]]);

  await fresh.close();
  await context.close();
  await verifyPublishOutput();
  console.log("artifact portability verification passed");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(tmp, { recursive: true, force: true });
}

async function assertShellPolish(page) {
  await page.waitForSelector("#blank-start:not([hidden])");
  assert.equal(await page.locator("#blank-start-new").isDisabled(), false, "new Rabbithole should remain actionable before model setup");
  assert.equal(await page.locator("#taskbar #t-rail").count(), 1, "rail toggle should live in the toolbar");
  assert.equal(await page.locator("#taskbar #t-new").count(), 1, "new Rabbithole button should live in the toolbar");
  assert.equal(await page.locator(".composer-path").count(), 4, "new Rabbithole should present four clear starting paths");
  await page.click("#t-settings");
  await page.click('[data-settings-section="model"]');
  await page.waitForSelector("#bridge-model");
  assert.equal(await page.locator("#bridge-model").count(), 1);
  assert.equal(await page.locator(".reasoning-choice").count(), 1);
  assert.match(await page.locator("#settings-panel").innerText(), /Backend\s+Codex/);
  await page.keyboard.press("Escape");
  await page.waitForSelector("#settings-sheet", { state: "detached" });
}

async function waitForCanvasText(page, text) {
  await page.locator(".card", { hasText: text }).first().waitFor();
}

async function ensureRailOpen(page) {
  if (await page.getAttribute("#t-rail", "aria-expanded") !== "true") {
    await page.click("#t-rail");
  }
  await page.waitForSelector("#web-rail.open");
}

function projectHole(hole) {
  // view_state is session-local; comparing captures from two sessions races their post-open saves. Canonical portable carry-over is covered by the artifact fixed-point tests.
  return {
    title: hole.title,
    root_id: hole.root_id,
    nodes: hole.nodes.map((node) => ({
      id: node.id,
      parent_id: node.parent_id,
      title: node.title,
      markdown: node.markdown,
      base_url: node.base_url,
      base_url_source: node.base_url_source,
      origin: node.origin,
      position: node.position,
      size: node.size,
      font_scale: node.font_scale,
      collapsed: node.collapsed,
      status: node.status,
      read: node.read,
      extensions: node.extensions,
    })),
  };
}

async function dropPdf(page, bytes) {
  await page.setInputFiles("#file-md", { name: "attention-is-all-you-need.pdf", mimeType: "application/pdf", buffer: Buffer.from(bytes) });
}

async function verifyPublishOutput() {
  const publish = spawnSync(process.execPath, ["scripts/build-publish.mjs"], { cwd: ROOT, encoding: "utf8" });
  if (publish.status !== 0) {
    process.stderr.write(publish.stderr || publish.stdout || "build:publish failed\n");
    process.exit(publish.status || 1);
  }
  const publishDir = path.join(ROOT, "publish");
  for (const file of ["index.html", "app.js", "styles.css", "katex.css", "dompurify.js", "pdf.mjs", "pdf.worker.mjs", "og.jpg", "robots.txt", "llms.txt", "favicon.svg", "_redirects", "_headers", "sitemap.xml", "about/index.html", "about/styles.css", "about/about.js", "about/demo-ask.mp4", "about/demo-map.mp4"]) {
    await fs.access(path.join(publishDir, file));
  }
  const redirects = await fs.readFile(path.join(publishDir, "_redirects"), "utf8");
  assert.equal(redirects.includes("www.rabbithole.ing"), false, "Cloudflare Pages redirects should contain only supported path rules");
  assert(redirects.includes("/* /index.html 200"), "publish fallback should make Rabbithole pathnames refreshable");
  assert(redirects.includes("/about /about/ 301"), "the historical homepage should have a canonical trailing-slash route");
  assert(redirects.includes("/install https://github.com/shlokkhemani/rabbithole#quick-start 302"), "the stable install route should lead to canonical GitHub instructions");
  assert(redirects.includes("/self-host https://github.com/shlokkhemani/rabbithole#run-the-browser-version-locally 302"), "the stable self-host route should lead to local browser instructions");
  const headers = await fs.readFile(path.join(publishDir, "_headers"), "utf8");
  assert(headers.includes("/app.js\n  Cache-Control: public, max-age=0, must-revalidate"), "the mutable app entry must revalidate after every deployment");
  assert(headers.includes("/chunks/*\n  Cache-Control: public, max-age=31536000, immutable"), "content-hashed deferred chunks should stay immutable between deployments");
  const chunks = await fs.readdir(path.join(publishDir, "chunks"));
  assert(chunks.some((name) => /^canvas-runtime-[A-Z0-9]+\.js$/.test(name)), "the hosted canvas runtime should remain outside the landing-page entry chunk");
  assert(chunks.some((name) => /^workspace-runtime-[A-Z0-9]+\.js$/.test(name)), "document creation, ingestion, and export should remain outside the landing-page entry chunk");
  assert(chunks.some((name) => /^settings-runtime-[A-Z0-9]+\.js$/.test(name)), "model setup and recovery should remain outside the landing-page entry chunk");
  const html = await fs.readFile(path.join(publishDir, "index.html"), "utf8");
  assert(html.includes("Rabbithole — an infinite canvas for learning"));
  assert(html.includes("connect-src 'self' blob: https:"), "web CSP should allow source ingestion and loopback bridge requests");
  assert(/script-src 'self' 'sha256-[^']+'/.test(html), "a broad connect-src is only safe while script-src stays locked to this origin");
  assert(html.includes("http://localhost:*") && html.includes("http://127.0.0.1:*"), "local endpoints stay reachable over plain http");
  assert(!html.includes('<html lang="en" data-theme="light">'), "published HTML must not force a light frame before theme initialization");
  const canonicalScript = html.match(/<script id="canonical-host-script">([\s\S]*?)<\/script>/)?.[1] || "";
  assert.equal(canonicalScript, 'if(location.hostname==="www.rabbithole.ing")location.replace("https://rabbithole.ing"+location.pathname+location.search+location.hash);');
  assert.equal(html.indexOf('<script id="canonical-host-script">'), html.indexOf("<head>") + "<head>\n".length, "host canonicalization should be the first thing in the head");
  const entryVersions = [...html.matchAll(/(?:favicon\.svg|styles\.css|app\.js)\?v=([a-f0-9]{12})/g)].map((match) => match[1]);
  assert.equal(entryVersions.length, 3, "every critical browser entry asset should carry a content-derived version");
  assert.equal(new Set(entryVersions).size, 1, "browser entry assets should share one atomic release version");
  assert(chunks.every((name) => /-[A-Z0-9]+\.js$/.test(name)), "every deferred application chunk should carry a content-derived filename");
  const initialStyleAt = html.indexOf('id="initial-theme-style"');
  const initialScriptAt = html.indexOf('id="initial-theme-script"');
  const stylesheetAt = html.indexOf('rel="stylesheet"');
  const appModuleAt = html.indexOf('type="module"');
  assert(initialStyleAt > 0 && initialStyleAt < initialScriptAt, "the dark-safe root background should precede theme selection");
  assert(initialScriptAt < stylesheetAt && stylesheetAt < appModuleAt, "theme selection must run before stylesheet and app loading");
  const initialScript = html.match(/<script id="initial-theme-script">([\s\S]*?)<\/script>/)?.[1] || "";
  assert(initialScript.includes('localStorage.getItem("rh-theme")'), "the first-paint theme should honor the saved choice");
  assert(initialScript.includes("prefers-color-scheme: dark"), "the first-paint theme should fall back to the system preference");
  const canonicalScriptHash = createHash("sha256").update(canonicalScript).digest("base64");
  const initialScriptHash = createHash("sha256").update(initialScript).digest("base64");
  assert(html.includes(`script-src 'self' 'sha256-${canonicalScriptHash}' 'sha256-${initialScriptHash}'`), "CSP should permit only the exact inline bootstraps");
  const llms = await fs.readFile(path.join(publishDir, "llms.txt"), "utf8");
  assert(llms.includes("https://rabbithole.ing/about/"), "agent-facing discovery should include the about page");
  assert(llms.includes("#run-the-browser-version-locally"), "agent-facing discovery should include local browser instructions");
  const about = await fs.readFile(path.join(publishDir, "about/index.html"), "utf8");
  assert(about.includes("Open the browser canvas"), "about page should lead with the zero-install browser path");
  assert(about.includes("Codex bridge"), "about page should describe local Codex setup");
  assert(about.includes("Star on GitHub"), "about page should carry a clear GitHub star action");
  assert(about.includes("data-github-stars"), "about page should show live repository stars in its GitHub actions");
  assert(about.includes("connect-src https://api.github.com"), "about CSP should allow the public GitHub star-count request");
  assert(about.includes("Generation uses your local Codex provider configuration"), "about copy should state the hosted-provider boundary accurately");
  assert(!about.includes("No account, no API keys, nothing leaves your machine"), "about page must not restore the obsolete privacy claim");
  const aboutVersions = [...about.matchAll(/(?:styles\.css|about\.js|demo-(?:ask|map)(?:-poster\.jpg|\.mp4))\?v=([a-f0-9]{12})/g)].map((match) => match[1]);
  assert.equal(aboutVersions.length, 6, "every mutable about-page asset should carry a content-derived version");
  assert.equal(new Set(aboutVersions).size, 1, "about-page assets should share one atomic release version");
  const sitemap = await fs.readFile(path.join(publishDir, "sitemap.xml"), "utf8");
  assert(sitemap.includes("https://rabbithole.ing/about/"), "sitemap should expose the about page");
}
