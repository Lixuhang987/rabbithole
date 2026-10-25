/** @protects URL article ingestion, relay fallback, and readable errors. */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { ensureWebDist } from "../support/build.mjs";
import { serveStatic } from "../support/static-server.mjs";
import { routeProvider, seedConfiguredBridge } from "../support/provider-mock.mjs";

ensureWebDist();
let proxyCalls = 0;
const server = await serveStatic("web/dist", { spaFallback: true, routes: {
  "/proxy": (_req, res) => {
    proxyCalls += 1;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end("<article><h1>Proxy fallback article</h1><p>Readable content fetched from the relay.</p></article>");
  },
  "/dead-proxy": (_req, res) => {
    res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end("proxy unavailable");
  },
  "/reject-proxy": (_req, res) => {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end("Host is not allowlisted: arxiv.org");
  },
} });
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

try {
  const context = await browser.newContext();
  await seedConfiguredBridge(context);
  const page = await context.newPage();
  let directArticleCalls = 0;
  await page.route(/https:\/\/ar5iv\.labs\.arxiv\.org\/html\/.+/, async (route) => {
    directArticleCalls += 1;
    await route.abort("failed");
  });
  await routeProvider(page);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__rabbitholeTest && !!document.getElementById("viewport"));

  await setFetchProxy(page, `${baseUrl}/proxy`);
  await page.click("#t-new");
  await page.click("#composer-path-url");
  await page.fill("#composer-input", "https://arxiv.org/abs/1234.5678");
  await page.click("#composer-primary");
  await page.locator(".card", { hasText: "Proxy fallback article" }).waitFor();
  assert(directArticleCalls > 0, "direct article fetch should be attempted before relay fallback");
  assert(proxyCalls > 0, "relay should be used after direct fetch fails");
  const stored = await page.evaluate(async () => window.__rabbitholeTest.readStoredHole());
  assert(stored.nodes.some((node) => node.markdown.includes("Readable content fetched from the relay.")));
  assert.equal(stored.nodes.find((node) => !node.parent_id).base_url, "https://ar5iv.labs.arxiv.org/html/1234.5678");

  await reloadReadyApp(page);
  await setFetchProxy(page, `${baseUrl}/dead-proxy`);
  await page.click("#t-new");
  await page.click("#composer-path-url");
  await page.fill("#composer-input", "https://arxiv.org/abs/9999.0000");
  await page.click("#composer-primary");
  await page.waitForSelector("#ingest-status.error");
  assert.match(await page.textContent("#ingest-status"), /Try another link or paste the text instead/i);

  await reloadReadyApp(page);
  await setFetchProxy(page, `${baseUrl}/reject-proxy`);
  await page.click("#t-new");
  await page.click("#composer-path-url");
  await page.fill("#composer-input", "https://arxiv.org/abs/7777.7777");
  await page.click("#composer-primary");
  await page.waitForSelector("#ingest-status.error");
  const rejected = await page.textContent("#ingest-status");
  assert.match(rejected, /isn't supported by the link relay yet/i);
  assert.match(rejected, /arXiv links work best/);
  await context.close();
  console.log("ok URL ingestion: direct fetch, relay fallback, and relay errors");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

async function reloadReadyApp(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__rabbitholeTest && !!document.getElementById("viewport"));
}

async function setFetchProxy(page, url) {
  await page.evaluate((value) => {
    const settings = JSON.parse(localStorage.getItem("rh-web-settings") || "{}");
    localStorage.setItem("rh-web-settings", JSON.stringify({ ...settings, fetch_proxy_url: value }));
    window.dispatchEvent(new StorageEvent("storage", { key: "rh-web-settings", newValue: JSON.stringify({ ...settings, fetch_proxy_url: value }) }));
  }, url);
}
