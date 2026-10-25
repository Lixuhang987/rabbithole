/** @protects source-ordered centered canvas organization, clear connectors, and saved/frozen layout. */
import assert from "node:assert/strict";
import { bootWebApp } from "../support/web-app-harness.mjs";
import { routeProvider, seedConfiguredBridge } from "../support/provider-mock.mjs";
import { selectVisibleText } from "../support/visible-selection.mjs";
import { assertClearCanvas, readCanvasGeometry } from "../support/canvas-layout-geometry.mjs";

const app = await bootWebApp();
try {
  const context = await app.browser.newContext({ viewport: { width: 1400, height: 950 } });
  await seedConfiguredBridge(context);
  const page = await context.newPage();
  await routeProvider(page, { streams: [
    ["TITLE: Later source\n", "Second source answer."],
    ["TITLE: Earlier source\n", "First source answer with a child."],
    ["TITLE: Shared source\n", "Another answer from the same earlier quotation."],
    ["TITLE: Deep child\n", Array.from({ length: 40 }, (_, i) => `Deep paragraph ${i}.`).join("\n\n")],
  ] });
  await page.goto(app.baseUrl, { waitUntil: "networkidle" });
  await page.evaluate((markdown) => window.__rabbitholeTest.createDocument(markdown),
    "# Centered branches\n\nFirst anchor.\n\n" + "Filler paragraph.\n\n".repeat(35) + "Second anchor.");
  await page.waitForSelector(".card.root .doc-content");
  async function ask(text, question, answer) {
    await selectVisibleText(page, { text, rootSelector: ".card.root .doc-content[data-node-id]" });
    await page.locator("#ask-text").fill(question);
    await page.locator('#ask [data-commit="ask"]').click();
    const card = page.locator(".card:not(.root)", { hasText: answer });
    await card.waitFor();
    return card;
  }
  const later = await ask("Second anchor", "Explain second", "Second source answer.");
  const earlier = await ask("First anchor", "Explain first", "First source answer with a child.");
  await ask("First anchor", "Explain first another way", "Another answer from the same earlier quotation.");
  await page.locator("#t-tidy").click();
  await page.evaluate(() => window.__rabbitholeTest.waitForCanvasViewSettled());
  await earlier.locator(".nc-handle").focus();
  await page.keyboard.press("Enter");
  await earlier.locator(".nc-inner textarea").fill("Add a deeper answer.");
  await earlier.locator(".nc-inner textarea").press("Control+Enter");
  await page.locator(".card", { hasText: "Deep paragraph 39." }).waitFor();

  await page.keyboard.press("Control+K");
  await page.locator(".pal-item", { hasText: "New note" }).click();
  const note = page.locator(".card-note:has(.note-editor)");
  await note.locator(".note-editor").fill("Independent note participates in Tidy.");
  await note.locator('[data-commit="note"]').click();
  await page.waitForFunction(async () => (await window.__rabbitholeTest.readStoredHole()).nodes.some((n) => n.origin?.kind === "note"));
  await page.locator("#t-tidy").click();
  await page.evaluate(() => window.__rabbitholeTest.waitForCanvasViewSettled());
  const portable = await page.evaluate(() => window.__rabbitholeTest.exportPortable());
  const geometry = await readCanvasGeometry(page);
  assertClearCanvas(geometry, portable.hole.nodes);
  const earlierId = await earlier.getAttribute("data-id"), laterId = await later.getAttribute("data-id");
  const earlierBox = geometry.cards.find((card) => card.id === earlierId);
  const laterBox = geometry.cards.find((card) => card.id === laterId);
  assert(earlierBox.y < laterBox.y, "source quotation order takes precedence over reverse creation order");
  assert.equal(earlierBox.x, laterBox.x, "siblings occupy the same depth column");
  const deep = portable.hole.nodes.find((node) => node.parent_id === earlierId);
  assert(geometry.cards.find((card) => card.id === deep.id).x > earlierBox.x + earlierBox.w,
    "a whole-article follow-up uses the next depth column too");

  await page.locator(".card.root .card-body").evaluate((body) => { body.scrollTop = body.scrollHeight; });
  await page.waitForTimeout(80);
  assertClearCanvas(await readCanvasGeometry(page), portable.hole.nodes);

  const head = earlier.locator(".card-head");
  const rect = await head.boundingBox();
  await page.mouse.move(rect.x + 65, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + 110, rect.y + rect.height / 2 + 60, { steps: 4 });
  await page.mouse.up();
  const moved = await readCanvasGeometry(page);
  assert.notEqual(moved.cards.find((card) => card.id === earlierId).y, earlierBox.y, "free dragging remains available");
  await page.locator("#t-tidy").click();
  await page.evaluate(() => window.__rabbitholeTest.waitForCanvasViewSettled());
  const organized = await readCanvasGeometry(page);
  assertClearCanvas(organized, portable.hole.nodes);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".card.root");
  const reopened = await readCanvasGeometry(page);
  assert.deepEqual(reopened.cards, organized.cards, "saved node positions reproduce the organized canvas");
  assertClearCanvas(reopened, portable.hole.nodes);

  const frozen = await context.newPage();
  await frozen.setContent(await page.evaluate(() => window.__rabbitholeTest.exportSnapshot()), { waitUntil: "load" });
  await frozen.waitForSelector(".card.root");
  const frozenGeometry = await readCanvasGeometry(frozen);
  assert.deepEqual(frozenGeometry.cards, reopened.cards, "a frozen snapshot keeps the same document geometry");
  assertClearCanvas(frozenGeometry, portable.hole.nodes);
  await context.close();
  console.log("ok centered canvas: source order, shared anchors, depth, independent notes, scroll, drag, reload, and snapshot");
} finally {
  await app.close();
}
