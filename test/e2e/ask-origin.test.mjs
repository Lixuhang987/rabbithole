/** @protects Complete folded Ask origins, prompt display, image previews and frozen PDF regions. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parsePersistedHole } from "../../src/core/schema.js";
import { buildPdfDocument } from "../../src/core/pdf-shared.js";
import { readAttentionPdfTwoPage } from "../support/attention-pdf.mjs";
import { routeProvider, seedConfiguredBridge } from "../support/provider-mock.mjs";
import { bootWebApp } from "../support/web-app-harness.mjs";

const portable = JSON.parse(await fs.readFile(new URL("../fixtures/corpus/01-empty-root.rabbithole", import.meta.url), "utf8"));
const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const bytes = await readAttentionPdfTwoPage();
const sha256 = createHash("sha256").update(bytes).digest("hex");
const source = { asset: `pdf-${sha256}.pdf`, sha256, byte_length: bytes.length };
const pdf = buildPdfDocument({ title: "Origin PDF", pageCount: 2, processedPages: [1],
  pageMetadata: [{ n: 1, view: [0, 0, 612, 792], rotate: 0, user_unit: 1 }],
  pageLines: [{ page: 1, lines: [] }], source });
const root = portable.hole.nodes[0];
root.markdown = pdf.markdown;
root.extensions.pdf = { ...pdf.pdfExtension, converted: true };
root.title = "Origin PDF";
const quote = "Quoted <literal> content\n" + "引用的完整文字。".repeat(40);
const instruction = "Saved full prompt\n" + "完整提示词。".repeat(40);
const question = "A typed question <kept literally>.\nSecond line.";
portable.hole.nodes.push({ ...root, id: "origin-answer", parent_id: root.id, title: "Answer title",
  markdown: "The answer body.", extensions: {}, read: false, collapsed: true,
  position: { x: 680, y: 0 }, size: { w: 480, h: 260 },
  origin: { selected_text: quote, question, instruction, lens: "explain", branch_type: "selection",
    attachment_assets: ["pixel.png"], anchor: { offset_start: 0, offset_end: 0, pdf: { version: 2, source_sha256: sha256,
      kind: "region", fragments: [{ page: 1, quads: [[[40, 700], [300, 700], [300, 600], [40, 600]]] }] } } },
});
portable.assets = { "pixel.png": pixel, [source.asset]: bytes.toString("base64") };
parsePersistedHole(portable.hole);
const app = await bootWebApp();
const snapshotDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-origin-"));
try {
  const context = await app.browser.newContext();
  await seedConfiguredBridge(context);
  const page = await context.newPage();
  await routeProvider(page);
  await page.goto(app.baseUrl, { waitUntil: "networkidle" });
  await page.setInputFiles("#file-md", { name: "origin.rabbithole", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(portable)) });
  const card = page.locator('.card[data-id="origin-answer"]');
  await card.waitFor();
  await assertOrigin(card);
  assert.equal(await card.locator(".doc-content").isVisible(), false, "folding hides the answer while retaining its origin");
  assert.equal(await card.evaluate((element) => element.offsetHeight > 260), true, "a complete origin may exceed the saved open height");
  await checkPreviews(page, card);
  await card.locator(".card-collapse").click();
  await assertOrigin(card);
  assert.equal(await card.locator(".doc-content").isVisible(), true);
  await card.locator('[aria-label="Expand document"]').click();
  await assertOrigin(page.locator(".reader-context"));
  await checkPreviews(page, page.locator(".reader-context"));
  await page.locator(".reader-context").focus();
  await page.locator(".reader-context").press("Enter");
  const railBranch = page.locator('.side-item[data-child="origin-answer"]');
  const railImage = railBranch.locator(".origin-attachment");
  await railImage.focus();
  await railImage.press("Enter");
  await page.locator(".rh-lightbox-img").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('#reader-main .doc-content[data-node-id="root"]').count(), 1,
    "opening a rail image must keep the source document open");
  await railBranch.focus();
  await railBranch.press("Enter");
  await assertOrigin(page.locator(".reader-context"));
  const snapshot = await page.evaluate(() => window.__rabbitholeTest.exportSnapshot());
  const frozen = await context.newPage();
  const snapshotPath = path.join(snapshotDirectory, "origin.html");
  await fs.writeFile(snapshotPath, snapshot);
  await frozen.goto(pathToFileURL(snapshotPath).href, { waitUntil: "load" });
  await frozen.locator('.card[data-id="origin-answer"] [aria-label="Expand document"]').evaluate((button) => button.click());
  await assertOrigin(frozen.locator(".reader-context"));
  await checkPreviews(frozen, frozen.locator(".reader-context"));
  await context.close();
} finally {
  await app.close();
  await fs.rm(snapshotDirectory, { recursive: true, force: true });
}

async function assertOrigin(surface) {
  assert.equal(await surface.locator(".origin-selection").innerText(), quote);
  assert.equal(await surface.locator(".origin-question").innerText(), instruction + "\n\n" + question);
  assert.equal(await surface.locator(".origin-selection").isVisible(), true);
  assert.equal(await surface.locator(".origin-question").isVisible(), true);
}

async function checkPreviews(page, surface) {
  for (const selector of [".origin-attachment", ".rh-origin-crop"]) {
    const button = surface.locator(selector);
    await page.waitForFunction((image) => image.naturalWidth > 0, await button.locator("img").elementHandle());
    assert.equal(await button.isVisible(), true);
    if (selector === ".rh-origin-crop") {
      await button.focus();
      await button.press("Enter");
    } else await button.click();
    await page.locator(".rh-lightbox-img").waitFor({ state: "visible", timeout: 5000 });
    await page.keyboard.press("Escape");
    await page.locator(".rh-lightbox").waitFor({ state: "detached" });
  }
}
