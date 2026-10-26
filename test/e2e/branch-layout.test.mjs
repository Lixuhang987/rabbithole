/** @protects source-ordered child clusters, shared-center cubic connections, hover, and saved/frozen layout. */
import assert from "node:assert/strict";
import { bootWebApp } from "../support/web-app-harness.mjs";
import { routeProvider, seedConfiguredBridge } from "../support/provider-mock.mjs";
import { selectVisibleText } from "../support/visible-selection.mjs";
import { assertCanvasConnections, readCanvasGeometry } from "../support/canvas-layout-geometry.mjs";
import { serializeForInlineScript } from "../../src/core/utils.js";

const app = await bootWebApp();
try {
  const context = await app.browser.newContext({ viewport: { width: 1400, height: 950 } });
  await seedConfiguredBridge(context);
  const page = await context.newPage();
  await routeProvider(page, { streams: [
    ["# Later source\n", "Second source answer."],
    ["# Earlier source\n", "First source answer with a child."],
    ["# Shared source\n", "Another answer from the same earlier quotation."],
    ["# Deep child\n", Array.from({ length: 40 }, (_, i) => `Deep paragraph ${i}.`).join("\n\n")],
    ["# Other cluster\n", "Child of the later source."],
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
  await later.locator(".nc-handle").focus();
  await page.keyboard.press("Enter");
  await later.locator(".nc-inner textarea").fill("Create another child cluster.");
  await later.locator(".nc-inner textarea").press("Control+Enter");
  await page.locator(".card", { hasText: "Child of the later source." }).waitFor();

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
  assertCanvasConnections(geometry, portable.hole.nodes);
  const earlierId = await earlier.getAttribute("data-id"), laterId = await later.getAttribute("data-id");
  const earlierBox = geometry.cards.find((card) => card.id === earlierId);
  const laterBox = geometry.cards.find((card) => card.id === laterId);
  assert(earlierBox.y < laterBox.y, "source quotation order takes precedence over reverse creation order");
  assert.equal(earlierBox.x, laterBox.x, "siblings occupy the same depth column");
  const deep = portable.hole.nodes.find((node) => node.parent_id === earlierId);
  assert(geometry.cards.find((card) => card.id === deep.id).x > earlierBox.x + earlierBox.w,
    "a whole-article follow-up uses the next depth column too");

  const other = portable.hole.nodes.find((node) => node.parent_id === laterId);
  const deepBox = geometry.cards.find((card) => card.id === deep.id);
  const otherBox = geometry.cards.find((card) => card.id === other.id);
  assert.equal(otherBox.y - deepBox.y - deepBox.h, 90, "different parents' children are visually separate clusters");
  const root = geometry.cards.find((card) => !portable.hole.nodes.find((node) => node.id === card.id)?.parent_id
    && portable.hole.nodes.some((node) => node.parent_id === card.id));
  const rootChildren = portable.hole.nodes.filter((node) => node.parent_id === root.id).map((node) => node.id);
  await page.locator(".card.root .card-head").hover();
  let hover = await readCanvasGeometry(page);
  assert.deepEqual(hover.edges.filter((edge) => edge.highlighted).map((edge) => edge.id).sort(), rootChildren.slice().sort(),
    "hovering a parent emphasizes its direct child cluster");
  await earlier.locator(".card-head").hover();
  hover = await readCanvasGeometry(page);
  assert.deepEqual(hover.edges.filter((edge) => edge.highlighted).map((edge) => edge.id).sort(), [earlierId, deep.id].sort(),
    "a card emphasizes its incoming edge and its own direct children");
  assert(await page.locator(`.card.root mark[data-child="${earlierId}"].mark-focus`).count(),
    "child hover keeps quotation feedback");

  await page.locator(".card.root .card-body").evaluate((body) => { body.scrollTop = body.scrollHeight; });
  await page.waitForTimeout(80);
  const scrolled = await readCanvasGeometry(page);
  assertCanvasConnections(scrolled, portable.hole.nodes);
  assert.deepEqual(scrolled.edges.map(({ id, d }) => ({ id, d })), geometry.edges.map(({ id, d }) => ({ id, d })),
    "scrolling source text leaves center ports and curves stationary");
  await page.locator(`.card.root mark[data-child="${laterId}"]`).first().hover();
  hover = await readCanvasGeometry(page);
  assert.deepEqual(hover.edges.filter((edge) => edge.highlighted).map((edge) => edge.id), [laterId],
    "quotation hover emphasizes its corresponding edge rather than the whole cluster");
  await page.locator(".card.root .card-head").hover();
  hover = await readCanvasGeometry(page);
  assert.equal(hover.edges.filter((edge) => edge.highlighted).length, rootChildren.length,
    "leaving a quotation for its parent header restores cluster emphasis");
  await page.locator("#t-theme").hover();

  const head = earlier.locator(".card-head");
  const rect = await head.boundingBox();
  await page.mouse.move(rect.x + 65, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + 110, rect.y + rect.height / 2 + 60, { steps: 4 });
  await page.mouse.up();
  const moved = await readCanvasGeometry(page);
  assert.notEqual(moved.cards.find((card) => card.id === earlierId).y, earlierBox.y, "free dragging remains available");
  async function dragEarlierTo(x, y) {
    await page.keyboard.press("Control+K");
    await page.locator("#pal-text").fill("Zoom to fit");
    await page.locator("#pal-text").press("Enter");
    await page.evaluate(() => window.__rabbitholeTest.waitForCanvasViewSettled());
    const current = await readCanvasGeometry(page);
    const card = current.cards.find((item) => item.id === earlierId);
    const headBox = await head.boundingBox();
    await page.mouse.move(headBox.x + headBox.width / 2, headBox.y + headBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(headBox.x + headBox.width / 2 + (x - card.x) * current.view.scale,
      headBox.y + headBox.height / 2 + (y - card.y) * current.view.scale, { steps: 4 });
    await page.mouse.up();
    return readCanvasGeometry(page);
  }
  const left = await dragEarlierTo(root.x - earlierBox.w - 70, root.y);
  assertCanvasConnections(left, portable.hole.nodes);
  assert.equal(left.ports.filter((port) => port.parentId === root.id).length, 2,
    "left and right children share one port on each occupied parent side");
  const below = await dragEarlierTo(root.x + root.w / 2 - earlierBox.w / 2 + 1, Math.max(...geometry.cards.map((card) => card.y + card.h)) + 100);
  assertCanvasConnections(below, portable.hole.nodes);
  assert.equal(below.ports.filter((port) => port.parentId === root.id).length, 1,
    "a child below and slightly right of center uses the right port and retires the empty left port");
  await page.locator("#t-tidy").click();
  await page.evaluate(() => window.__rabbitholeTest.waitForCanvasViewSettled());
  const organized = await readCanvasGeometry(page);
  assertCanvasConnections(organized, portable.hole.nodes);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".card.root");
  const reopened = await readCanvasGeometry(page);
  assert.deepEqual(reopened.cards, organized.cards, "saved node positions reproduce the organized canvas");
  assertCanvasConnections(reopened, portable.hole.nodes);

  const frozen = await context.newPage();
  const snapshot = await page.evaluate(() => window.__rabbitholeTest.exportSnapshot());
  await frozen.setContent(snapshot, { waitUntil: "load" });
  await frozen.waitForSelector(".card.root");
  const frozenGeometry = await readCanvasGeometry(frozen);
  assert.deepEqual(frozenGeometry.cards, reopened.cards, "a frozen snapshot keeps the same document geometry");
  assertCanvasConnections(frozenGeometry, portable.hole.nodes);
  await frozen.locator(".card.root .card-head").hover();
  const frozenHover = await readCanvasGeometry(frozen);
  assert.deepEqual(frozenHover.edges.filter((edge) => edge.highlighted).map((edge) => edge.id).sort(), rootChildren.slice().sort(),
    "frozen parent hover emphasizes the same child cluster");
  assert(frozenHover.ports.find((port) => port.parentId === root.id).highlighted,
    "the shared dot reflects cluster emphasis");
  // An artifact fixture supplies an exact tie without pointer-coordinate rounding.
  const tiedSnapshot = snapshot.replace(/(<script[^>]*id="rabbithole-portable"[^>]*>)([\s\S]*?)(<\/script>)/,
    (_match, open, json, close) => {
      const projection = JSON.parse(json);
      const parent = projection.hole.nodes.find((node) => node.id === root.id);
      const child = projection.hole.nodes.find((node) => node.id === earlierId);
      child.position.x = parent.position.x + (parent.size.w - child.size.w) / 2;
      child.position.y = Math.max(...frozenGeometry.cards.map((card) => card.y + card.h)) + 100;
      return open + serializeForInlineScript(projection) + close;
    });
  await frozen.setContent(tiedSnapshot, { waitUntil: "load" });
  await frozen.waitForSelector(".card.root");
  const tied = await readCanvasGeometry(frozen);
  assertCanvasConnections(tied, portable.hole.nodes);
  assert.equal(tied.ports.filter((port) => port.parentId === root.id).length, 1,
    "an exact horizontal tie shares the right parent port");
  await context.close();
  console.log("ok centered canvas: source order, shared center ports, clusters, hover, depth, notes, scroll, drag, reload, and snapshot");
} finally {
  await app.close();
}
