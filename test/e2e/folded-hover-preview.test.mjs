/** @protects compact folds, inert full-document hover excerpts and Tab reader expansion. */
import assert from "node:assert/strict";
import { bootWebApp } from "../support/web-app-harness.mjs";
import { routeProvider, seedConfiguredBridge } from "../support/provider-mock.mjs";
import { panCanvasBy, selectVisibleText } from "../support/visible-selection.mjs";

const app = await bootWebApp();
try {
  const context = await app.browser.newContext({ viewport: { width: 1400, height: 950 } });
  await seedConfiguredBridge(context);
  const page = await context.newPage();
  const quote = "A passage to preview in full.";
  const prompt = "Explain the passage.\nKeep the complete question.";
  const answer = "## Preview answer\n\n" + Array.from({ length: 70 }, (_, i) =>
    `Paragraph ${i + 1} of the complete answer with **formatted content**.`).join("\n\n");
  await routeProvider(page, { streams: [["TITLE: A deliberately long answer title that must remain compact when folded\n", answer]] });
  await page.goto(app.baseUrl, { waitUntil: "networkidle" });
  await page.evaluate((markdown) => window.__rabbitholeTest.createDocument(markdown), "# Hover fixture\n\n" + quote);
  await selectVisibleText(page, { text: quote, rootSelector: ".card.root .doc-content" });
  await page.locator("#ask-text").fill(prompt);
  await page.locator("#ask-text").evaluate(async (editor) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([blob], "preview.png", { type: "image/png" }));
    editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await page.locator("#ask .paste-attachment img").waitFor();
  await page.locator('#ask [data-commit="ask"]').click();
  const card = page.locator(".card:not(.root)", { hasText: "Paragraph 70" });
  await card.waitFor();
  const id = await card.getAttribute("data-id");
  await page.waitForFunction(async (id) => (await window.__rabbitholeTest.readStoredHole()).nodes
    .some((node) => node.id === id && node.status === "answered"), id);
  await card.locator(".card-collapse").evaluate((button) => button.click());
  assert.equal(await card.locator(".card-body").isVisible(), false);
  assert.equal(await card.locator(".card-title").evaluate((el) => getComputedStyle(el).textOverflow), "ellipsis");
  const preview = page.locator(".folded-preview");

  async function hover() {
    await page.mouse.move(2, 2);
    const box = await card.locator(".card-head").boundingBox();
    await panCanvasBy(page, { x: 700 - box.x - box.width / 2, y: 475 - box.y - box.height / 2 });
    await card.locator(".card-title").hover();
    await preview.waitFor();
  }

  await hover();
  const foldedBox = await card.boundingBox();
  assert.equal(await preview.locator(".origin-selection").textContent(), quote);
  assert.equal(await preview.locator(".origin-question").textContent(), prompt);
  assert.match(await preview.locator(".doc-content").textContent(), /Paragraph 70/);
  assert.equal(await preview.locator(".doc-content strong").first().textContent(), "formatted content");
  assert.equal(await preview.locator(".origin-attachment-strip img").count(), 1);
  await page.waitForFunction(() => document.querySelector(".folded-preview")?.classList.contains("clipped"));
  const geometry = await preview.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { centerX: box.x + box.width / 2, centerY: box.y + box.height / 2,
      width: box.width, height: box.height, pointerEvents: style.pointerEvents,
      inert: el.inert, font: parseFloat(getComputedStyle(el.querySelector(".doc-content")).fontSize),
      quoteFont: parseFloat(getComputedStyle(el.querySelector(".origin-context")).fontSize),
      fade: getComputedStyle(el.querySelector(".folded-preview-clip"), "::after").backgroundImage };
  });
  assert(Math.abs(geometry.centerX - 700) < 1 && Math.abs(geometry.centerY - 475) < 1);
  assert(geometry.width <= 1260 && geometry.height <= 760 && geometry.height > 700);
  assert(geometry.font >= 18 && geometry.quoteFont >= 18);
  assert.equal(geometry.inert, true);
  assert.equal(geometry.pointerEvents, "none");
  assert.match(geometry.fade, /gradient/);
  assert.match(await preview.textContent(), /Tab/);
  assert.deepEqual(await card.boundingBox(), foldedBox, "preview does not alter folded geometry");

  await page.locator(".card.root .nc-handle").focus();
  await page.keyboard.press("Enter");
  const draft = page.locator(".card.root .nc-inner textarea");
  await draft.fill("A draft keeps normal Tab navigation while a different card is hovered.");
  await hover();
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("body").evaluate((el) => el.classList.contains("mode-canvas")), true,
    "typing retains normal Tab navigation even while the pointer previews another document");
  await card.locator(".card-collapse").focus();
  await hover();

  // The excerpt overlaps its own anchor; hit-testing must still reach the tab.
  const titleBox = await card.locator(".card-title").boundingBox();
  assert.equal(await page.evaluate(({ x, y, id }) =>
    document.elementFromPoint(x, y)?.closest(".card")?.dataset.id === id,
  { x: titleBox.x + 10, y: titleBox.y + 5, id }), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.locator("body").evaluate((el) => el.classList.contains("mode-canvas")), true);
  await hover();
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => !document.body.classList.contains("mode-canvas"));
  await preview.waitFor({ state: "detached" });
  assert.equal(await page.locator("#reader-main .origin-selection").textContent(), quote);
  assert.match(await page.locator("#reader-main .doc-content").textContent(), /Paragraph 70/);
  assert.equal((await page.evaluate(() => window.__rabbitholeTest.readStoredHole())).nodes
    .find((node) => node.id === id).collapsed, true, "Tab expands the reader just like the header icon");

  await page.locator("#reader-restore").click();
  await hover();
  await card.locator(".card-more").focus();
  await page.keyboard.press("Enter");
  await page.locator("#cardmenu.visible").waitFor();
  await preview.waitFor({ state: "detached" });
  await page.locator("#cm-textdown").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.locator("body").evaluate((el) => el.classList.contains("mode-canvas")), true,
    "keyboard-opened menus keep their Tab navigation while a folded header is hovered");
  await page.waitForSelector("#cardmenu.visible", { state: "hidden" });
  await hover();
  await page.mouse.move(5, 5);
  await preview.waitFor({ state: "detached" });
  await hover();
  await card.locator(".card-more").hover();
  await preview.waitFor({ state: "detached" });
  await card.locator(".card-more").click();
  await page.locator("#cm-pin").click();
  await card.locator(".card-title").hover();
  await preview.waitFor();
  assert.equal(await preview.locator(".origin-question").textContent(), prompt, "actual pinned cards share the hover flow");
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => !document.body.classList.contains("mode-canvas"));
  await page.locator("#reader-restore").click();
  await card.locator(".pinned-pin").click();
  await hover();
  await card.locator(".card-collapse").click();
  await preview.waitFor({ state: "detached" });
  assert.equal(await card.locator(".card-body").isVisible(), true, "original unfold control remains available through the preview");
  await context.close();
  console.log("ok folded preview: full origin, body, attachment, clipping, enlarged text, anchor, Tab and pins");
} finally {
  await app.close();
}
