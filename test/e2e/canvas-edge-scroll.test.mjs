/** @protects canvas edge scroll and anchored Command-wheel zoom capability contracts. */
import assert from "node:assert/strict";
import { routeProvider, seedConfiguredBridge } from "../support/provider-mock.mjs";
import { bootWebApp } from "../support/web-app-harness.mjs";

const app = await bootWebApp();
const { browser, baseUrl } = app;

try {
  await verifyEdgeScrollCarriesTheCard();
  console.log("canvas edge-scroll and Command-wheel zoom verification passed");
} finally {
  await app.close();
}

// Dragging a card into the edge of the viewport must scroll the canvas under
// it, and the card must stay pinned to the cursor while that happens — the
// whole point is carrying a card somewhere that is not on screen yet.
async function verifyEdgeScrollCarriesTheCard() {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  try {
    await seedConfiguredBridge(context);
    const page = await context.newPage();
    await routeProvider(page);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await createDocument(page, "# Edge scroll\n\nA card must be draggable past the edge of what is on screen.");
    await page.waitForFunction(() => document.body.classList.contains("mode-canvas"));
    await settleCamera(page);
    await verifyCommandWheelZoom(page);

    const head = page.locator(".card.root .card-head").first();
    const start = await head.boundingBox();
    await settleCamera(page);
    const before = await readCanvasState(page);

    // This card is taller than it is wide, so the drag stays on one row: moving
    // it down far enough to test the horizontal edge would push its bottom off
    // screen, which is a separate axis with its own behaviour.
    const ROW = start.y + start.height / 2;

    await page.mouse.move(start.x + start.width / 2, ROW);
    await page.mouse.down();
    // Well short of the edge: the drag moves the card, the camera holds still.
    await page.mouse.move(420, ROW, { steps: 8 });
    const settled = await readCanvasState(page);
    assert.equal(settled.viewX, before.viewX, "a drag away from the edges must not move the camera");
    assert.equal(settled.viewY, before.viewY, "a drag away from the edges must not move the camera");

    // Approaching the edge is not enough on its own: the band is thin by design,
    // so a drag that stops well short of the boundary leaves the camera alone.
    await page.mouse.move(940, ROW, { steps: 8 });
    const approached = await readCanvasState(page);
    await page.waitForTimeout(250);
    assert.equal(
      (await readCanvasState(page)).viewX,
      approached.viewX,
      "approaching the edge without reaching it must not move the camera",
    );

    // At the right edge, then hold still. No further pointer input from here:
    // the scroll has to keep running on its own until the pointer leaves.
    await page.mouse.move(999, ROW, { steps: 8 });
    const armed = await readCanvasState(page);
    await page.waitForTimeout(600);
    const scrolled = await readCanvasState(page);

    assert.ok(
      scrolled.viewX < armed.viewX - 100,
      `holding at the right edge should reveal content to the right (viewX ${armed.viewX} -> ${scrolled.viewX})`,
    );
    assert.equal(scrolled.viewY, armed.viewY, "an unarmed axis must stay put");
    assert.ok(
      scrolled.nodeX > armed.nodeX + 100,
      `the card should travel into the newly revealed canvas (nodeX ${armed.nodeX} -> ${scrolled.nodeX})`,
    );

    // Pinned to the cursor: the card has to arrive where it was dropped, not
    // trail the pan by however far the camera moved.
    const heldHead = await head.boundingBox();
    assert.ok(
      heldHead.x <= 999 && 999 <= heldHead.x + heldHead.width,
      `the card must stay under the cursor while the canvas scrolls (head spans ${heldHead.x}-${heldHead.x + heldHead.width})`,
    );

    // Back inside the viewport: the scroll stops rather than coasting.
    await page.mouse.move(420, ROW, { steps: 8 });
    const parked = await readCanvasState(page);
    await page.waitForTimeout(250);
    assert.equal((await readCanvasState(page)).viewX, parked.viewX, "leaving the band must stop the scroll");

    // And releasing leaves nothing running.
    await page.mouse.move(999, ROW, { steps: 8 });
    await page.mouse.up();
    const dropped = await readCanvasState(page);
    await page.waitForTimeout(250);
    assert.equal((await readCanvasState(page)).viewX, dropped.viewX, "releasing the drag must stop the scroll");
  } finally {
    await context.close();
  }
}

async function verifyCommandWheelZoom(page) {
  const head = await page.locator(".card.root .card-head").first().boundingBox();
  const x = Math.round(head.x + head.width / 2);
  const y = Math.round(head.y + head.height / 2);
  const before = await readCanvasState(page);
  const anchor = { x: (x - before.viewX) / before.scale, y: (y - before.viewY) / before.scale };

  await page.keyboard.down("Meta");
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -60);
  await waitForScale(page, before.scale, "in");
  const enlarged = await readCanvasState(page);
  assert.ok(enlarged.scale > before.scale, "Command + wheel upward must zoom in over a card");
  assert.ok(Math.abs(enlarged.viewX + anchor.x * enlarged.scale - x) < 0.01, "zoom must hold the horizontal cursor anchor");
  assert.ok(Math.abs(enlarged.viewY + anchor.y * enlarged.scale - y) < 0.01, "zoom must hold the vertical cursor anchor");
  assert.equal(enlarged.nodeX, before.nodeX, "zoom must preserve the card's document position");
  assert.equal(enlarged.nodeY, before.nodeY, "zoom must preserve the card's document position");

  await page.mouse.wheel(0, 120);
  await waitForScale(page, before.scale, "out");
  assert.ok((await readCanvasState(page)).scale < before.scale, "Command + wheel downward must zoom out");
  await page.mouse.wheel(0, -60);
  await waitForScale(page, before.scale, "restore");
  await page.keyboard.up("Meta");
  const released = await readCanvasState(page);
  await page.mouse.wheel(0, 40);
  await page.waitForTimeout(100);
  assert.deepEqual(await readCanvasState(page), released, "an ordinary wheel over the card header must preserve the camera");
}

async function waitForScale(page, baseline, direction) {
  await page.waitForFunction(({ baseline, direction }) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(document.getElementById("world")).transform);
    if (direction === "in") return matrix.a > baseline;
    if (direction === "out") return matrix.a < baseline;
    return Math.abs(matrix.a - baseline) < 0.00001;
  }, { baseline, direction });
}

// The camera is a transform on #world, so read it back the way the browser sees
// it rather than trusting module state the page never exposes.
function readCanvasState(page) {
  return page.evaluate(() => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(document.getElementById("world")).transform);
    const card = document.querySelector(".card.root");
    return { viewX: matrix.m41, viewY: matrix.m42, scale: matrix.a, nodeX: parseFloat(card.style.left), nodeY: parseFloat(card.style.top) };
  });
}

// Entering the canvas frames the tree, which may glide. A baseline read mid-
// glide would drift on its own and make "the camera held still" look false.
async function settleCamera(page) {
  let previous = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const { viewX, viewY } = await readCanvasState(page);
    if (previous && previous.viewX === viewX && previous.viewY === viewY) return;
    previous = { viewX, viewY };
    await page.waitForTimeout(50);
  }
  throw new Error("the canvas camera never settled");
}

async function createDocument(page, markdown) {
  const previous = await page.evaluate(() => window.__rabbitholeTest?.currentHoleId?.() || "");
  await page.evaluate((value) => window.__rabbitholeTest.createDocument(value), markdown);
  await page.waitForFunction((oldId) => {
    const id = window.__rabbitholeTest?.currentHoleId?.();
    return id && id !== oldId;
  }, previous);
  await page.waitForSelector(".card .doc-content[data-node-id]");
}
