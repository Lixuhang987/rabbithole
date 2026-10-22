/** @protects fresh-browser document, attachment and native-conversation reopening after bridge restart. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { bootWebApp } from "../support/web-app-harness.mjs";
import { createStoreFixture } from "../support/backend-store.mjs";

const app = await bootWebApp();
const fixture = await createStoreFixture();
try {
  const context = await app.browser.newContext();
  const page = await context.newPage();
  await page.goto(`${app.baseUrl}/#bridge=${fixture.bridge.token}&bridge_port=${fixture.bridge.port}`);
  await page.waitForFunction(() => !document.getElementById("blank-start-new-wrap").hasAttribute("data-setup-required"));
  await page.click("#blank-start-new");
  await page.click("#composer-path-ask");
  await page.fill("#composer-input", "Durable root question");
  await page.click("#composer-primary");
  await page.locator(".card.root .doc-content").waitFor();
  await waitForSaved(page, (hole) => hole?.nodes.some((node) => node.extensions?.backend_conversation));
  const id = await page.evaluate(() => window.__rabbitholeTest.currentHoleId());
  assert.ok(await fixture.store.loadHole(id), "the generated document must already be on the backend");
  await page.locator(".card.root .nc-handle").evaluate((button) => button.click());
  const editor = page.locator(".card.root .nc-inner textarea");
  await editor.fill("Persistent image note");
  await editor.evaluate(async (element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 16;
    canvas.getContext("2d").fillRect(0, 0, 16, 16);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const clipboardData = new DataTransfer();
    clipboardData.items.add(new File([blob], "clipboard.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  });
  await page.locator(".card.root .paste-attachment img").waitFor();
  await editor.press("Enter");
  await waitForSaved(page, (hole) => hole?.nodes.some((node) => node.origin?.kind === "note"));
  const before = await fixture.store.loadHole(id);
  const assets = await fixture.store.getAssets(id);
  assert.equal(assets.length, 1);
  const bytes = new Uint8Array(await assets[0].blob.arrayBuffer());
  await context.close();
  const store = await fixture.restart();
  const fresh = await app.browser.newContext();
  const reopened = await fresh.newPage();
  const alternateOrigin = app.baseUrl.replace("127.0.0.1", "localhost");
  await reopened.goto(`${alternateOrigin}/${id}#bridge=${fixture.bridge.token}&bridge_port=${fixture.bridge.port}`);
  await reopened.waitForFunction((holeId) => window.__rabbitholeTest?.currentHoleId() === holeId, id);
  const after = await store.loadHole(id);
  assert.deepEqual(after.nodes, before.nodes, "a new browser and bridge preserve node content, layout and references");
  assert.deepEqual(new Uint8Array(await (await store.getAsset(id, assets[0].name)).arrayBuffer()), bytes);
  await reopened.locator(".card-note .doc-content img").waitFor();
  await reopened.locator(".card.root .nc-handle").evaluate((button) => button.click());
  await reopened.fill(".card.root .nc-inner textarea", "Follow up after losing browser storage");
  await reopened.locator('.card.root .nc-inner [data-commit="ask"]').click();
  await waitForSaved(reopened, (hole) => hole?.nodes.filter((node) => node.extensions?.backend_conversation).length === 2);
  const history = JSON.parse(await fs.readFile(fixture.env.FAKE_CODEX_HISTORY, "utf8"));
  assert.equal(history.threads.length, 2, "reopening forks the persisted native source conversation");
  assert.equal((await store.listHoles()).length, 1);
  const missing = await fresh.newPage();
  await missing.goto(`${alternateOrigin}/missing-document-000000`);
  await missing.getByText("This Rabbithole was not found.", { exact: true }).waitFor();
  await missing.waitForFunction(() => !!window.__rabbitholeTest);
  assert.equal(await missing.evaluate(() => window.__rabbitholeTest.currentHoleId()), null);
  assert.equal((await store.listHoles()).length, 1, "a missing link must not create a replacement document");
  await fresh.close();
  await verifyConnectionIdentity();
  console.log("ok backend persistence: fresh browser, alternate origin, bridge restart, image and native fork");
} finally { await app.close(); await fixture.close(); }

async function waitForSaved(page, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const hole = await page.evaluate(() => window.__rabbitholeTest.readStoredHole());
    if (predicate(hole)) return hole;
    await delay(25);
  }
  assert.fail("document save did not reach the backend");
}

async function verifyConnectionIdentity() {
  const original = await createStoreFixture();
  const replacement = await createStoreFixture();
  const context = await app.browser.newContext();
  let release = () => {};
  const held = new Promise((resolve) => { release = () => resolve(null); });
  try {
    const page = await context.newPage();
    await page.goto(`${app.baseUrl}/#bridge=${original.bridge.token}&bridge_port=${original.bridge.port}`);
    await page.waitForFunction(() => !!window.__rabbitholeTest);
    let saved;
    const saving = new Promise((resolve) => { saved = resolve; });
    await page.route(`${original.bridge.url}/bridge/store/holes/*`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      saved();
      await held;
      await route.fulfill({ response });
    });
    // A successful import can finish while another tab changes the pairing.
    // Hold only its success response; all storage operations still reach disk.
    const creating = page.evaluate(() => window.__rabbitholeTest.createDocument("# Connection owner\n\nSaved on the original bridge."));
    await saving;
    const paired = page.waitForResponse(`${replacement.bridge.url}/bridge/store/holes/missing-document-000000`);
    await page.evaluate(({ token, port }) => {
      history.replaceState(null, "", "/missing-document-000000");
      location.hash = `bridge=${token}&bridge_port=${port}`;
    }, { token: replacement.bridge.token, port: replacement.bridge.port });
    await paired;
    release();
    await creating;
    assert.equal(await page.evaluate(() => window.__rabbitholeTest.currentHoleId()), null,
      "a completed import must not mount against another store");
    assert.deepEqual(await replacement.store.listHoles(), []);
    const [summary] = await original.store.listHoles();
    assert.ok(summary, "the successful import remains on its original bridge");

    await page.unroute(`${original.bridge.url}/bridge/store/holes/*`);
    await page.evaluate(({ token, port }) => {
      history.replaceState(null, "", "/");
      location.hash = `bridge=${token}&bridge_port=${port}`;
    }, { token: original.bridge.token, port: original.bridge.port });
    await page.waitForFunction((id) => window.__rabbitholeTest.currentHoleId() === id, summary.hole_id);
    await page.click("#t-rail");
    await page.locator(`.rail-row[data-hole="${summary.hole_id}"]`).hover();
    await page.locator(`.rail-row[data-hole="${summary.hole_id}"] .rail-delete`).click();
    await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
    await page.evaluate(() => history.replaceState(null, "", "/"));
    const replacementListed = page.waitForResponse(`${replacement.bridge.url}/bridge/store/holes`);
    const pairing = await context.newPage();
    await pairing.goto(`${app.baseUrl}/#bridge=${replacement.bridge.token}&bridge_port=${replacement.bridge.port}`);
    await replacementListed;
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    const deadline = Date.now() + 5000;
    while (!(await original.store.loadHole(summary.hole_id)) && Date.now() < deadline) await delay(25);
    assert.ok(await original.store.loadHole(summary.hole_id), "Undo restores the original bridge document");
    assert.deepEqual(await replacement.store.listHoles(), [], "Undo must not copy a document into the newly paired bridge");
  } finally {
    release();
    await context.close();
    await original.close();
    await replacement.close();
  }
}
