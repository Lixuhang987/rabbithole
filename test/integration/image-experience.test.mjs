/** @protects image experience capability contracts. */
import { seedStorageBridge } from "../support/backend-store.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { renderMarkdownToHtml } from "../../src/core/markdown.js";
import { extractSnapshotPayload, SNAPSHOT_PAYLOAD_OPEN } from "../../src/core/portable-import.js";
import { validatePortableProjection } from "../../src/core/portable-projection.js";
import { snapshotFixture } from "../support/snapshot-fixture.mjs";
import { bootWebApp } from "../support/web-app-harness.mjs";
import { toPersistedHole } from "../../src/core/schema.js";
import { CANVAS_STYLES } from "../support/design-css.mjs";

process.env.RABBITHOLE_NO_BROWSER = "1";
process.env.RABBITHOLE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-image-experience-"));

function assertIncludes(haystack, needle, message) {
  assert(haystack.includes(needle), message || `expected to include ${needle}`);
}

function extractScript(html) {
  const match = html.match(/<script>\n([\s\S]*)\n<\/script>/);
  assert(match, "assembled HTML should contain one inline script");
  return match[1];
}

async function runMarkdownSmoke() {
  const html = await renderMarkdownToHtml("Before\n\n![diagram](asset:diagram-1.png)\n\nAfter", {
    assetNames: new Set(["diagram-1.png"]),
  });
  assertIncludes(html, '<img src="/assets/diagram-1.png" alt="diagram">');
  assert(!html.includes("rh-img-frame"), "markdown sanitizer should emit plain safe img tags");

  const showHtml = await renderMarkdownToHtml(["```show", '<img src="https://example.com/diagram.png">', "```"].join("\n"));
  assertIncludes(showHtml, 'class="viz"');
  assert(!showHtml.includes("rh-img-frame"), "show fences should remain visual placeholders before client mount");
  console.log("ok image ux: markdown image smoke");
}

async function runPageFixtures() {
  const markdown = [
    "Root image:",
    "",
    "![diagram](asset:diagram-1.png)",
    "",
    "```show",
    '<img src="https://example.com/in-show.png">',
    "```",
  ].join("\n");
  const root = {
    id: "root",
    parent_id: null,
    title: "Root",
    markdown,
    origin: null,
    position: { x: 0, y: 0 },
    size: null,
    font_scale: 1,
    collapsed: false,
    status: "answered",
    read: true,
    created_at: new Date().toISOString(),
  };

  const liveHtml = await snapshotFixture({ title: "Image Experience", root_id: "root", nodes: [root] }, { "diagram-1.png": "AA==" });
  const script = extractScript(liveHtml);
    const imageUxSource = await fs.readFile(path.resolve("src/ui/image-ux.js"), "utf8");
    const lightboxSource = await fs.readFile(path.resolve("src/ui/lightbox.js"), "utf8");

    assertIncludes(imageUxSource, "function mountDocImages", "image UX should mount markdown image wrappers");
    assertIncludes(imageUxSource, "function openImageLightbox", "image UX should include the lightbox");
    assertIncludes(imageUxSource, "function beginImageResize", "image UX should include resize handler code");
    assertIncludes(imageUxSource, "function nearestImageScrollContainer", "resize should discover the actual scroll container");
    assertIncludes(imageUxSource, "function keepImageHandleAnchored", "resize should compensate scroll while image height changes");
    assertIncludes(imageUxSource, "afterRect.bottom - beforeRect.bottom", "resize should anchor the handle by the frame-bottom delta");
    assertIncludes(imageUxSource, "scroller.scrollTop += delta / imageScrollScale(scroller)", "resize should adjust scrollTop in scroller-local pixels");
    assertIncludes(lightboxSource, "LIGHTBOX_MAX_ZOOM = 6", "shared lightbox zoom should clamp at the requested upper bound");
    assertIncludes(imageUxSource, "openLightbox({", "image UX should delegate previews to the shared lightbox");
    assertIncludes(imageUxSource, 'img.closest(".viz, .viz-mounted")', "show-fence images should be skipped by image UX mount");
    assertIncludes(CANVAS_STYLES, 'html[data-theme="dark"] .md .rh-img-frame', "canvas CSS should define the dark-mode image matte");
    assertIncludes(CANVAS_STYLES, '.md .rh-img-frame[data-rh-resized="1"] { display: block; margin-left: auto; margin-right: auto; }', "resized images should center in the content column");
    assertIncludes(liveHtml, "--image-matte", "served page should carry the bundled image-matte CSS");
    assert(!CANVAS_STYLES.includes('html[data-theme="dark"] .md img'), "matte selector should not target every .md img directly");

    const scriptPath = path.join(process.env.RABBITHOLE_DIR, "image-client.js");
    await fs.writeFile(scriptPath, script, "utf8");
    const check = spawnSync(process.execPath, ["--check", scriptPath], { encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr || check.stdout);

    assertIncludes(liveHtml, "--image-matte", "snapshot retains image-matte CSS");

}

async function runLiveSnapshotDownload() {
  const referencedBytes = Buffer.from("referenced snapshot asset");
  const pastedBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const unreferencedBytes = Buffer.from("unreferenced snapshot asset");
  const now = new Date().toISOString();
  const hole = { hole_id: "image-live-snapshot", title: "Image Live Snapshot", root_id: "root", created_at: now,
    nodes: [
      {
        id: "root", parent_id: null, title: "Root",
        markdown: "Referenced asset ![diagram](asset:diagram.png)\n\n![Pasted image](asset:paste-deadbeef.png)",
        origin: null, position: { x: 0, y: 0 }, size: null, font_scale: 1,
        collapsed: false, status: "answered", read: true, created_at: now,
      },
      {
        id: "pending", parent_id: "root", title: "Pending",
        markdown: "half-streamed markdown must not escape", question: "Finish this answer",
        origin: null, position: { x: 420, y: 0 }, size: null, font_scale: 1,
        collapsed: false, status: "pending", read: false, created_at: now,
      },
    ],
  };
  const app = await bootWebApp();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ acceptDownloads: true });
    const storage = await seedStorageBridge(page.context());
    await page.goto(app.baseUrl);
    await page.waitForFunction(() => !!window.__rabbitholeTest);
    await page.keyboard.press("Escape");
    await page.evaluate((markdown) => window.__rabbitholeTest.createDocument(markdown), hole.nodes[0].markdown);
    const holeId = await page.evaluate(() => window.__rabbitholeTest.currentHoleId());
    const persisted = toPersistedHole({ ...hole, hole_id: holeId });
    await storage.store.saveHole(persisted);
    await storage.store.putAsset(persisted.hole_id, "diagram.png", referencedBytes);
    await storage.store.putAsset(persisted.hole_id, "paste-deadbeef.png", pastedBytes);
    await storage.store.putAsset(persisted.hole_id, "unused.png", unreferencedBytes);
    await page.reload();
    await page.waitForSelector("#t-share");
    await page.waitForSelector(".rh-img-frame .rh-img-handle");
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    const sourceImage = page.locator('.rh-img-frame img[alt="diagram"]');
    const pastedImage = page.locator('.rh-img-frame img[alt="Pasted image"]');
    assert.deepEqual(await sourceImage.locator("..").evaluate((frame) => {
      const style = getComputedStyle(frame);
      return { pasted: frame.dataset.rhPasted || null, padding: style.paddingTop,
        background: style.backgroundColor, border: style.borderTopWidth };
    }), { pasted: null, padding: "8px", background: "rgb(244, 244, 241)", border: "1px" },
    "ordinary asset images should retain the dark-theme matte");
    assert.deepEqual(await pastedImage.locator("..").evaluate((frame) => {
      const style = getComputedStyle(frame);
      return { pasted: frame.dataset.rhPasted || null, padding: style.paddingTop,
        background: style.backgroundColor, border: style.borderTopWidth };
    }), { pasted: "1", padding: "0px", background: "rgba(0, 0, 0, 0)", border: "0px" },
    "pasted asset images should not receive the dark-theme matte");
    await sourceImage.click();
    await page.waitForSelector(".rh-lightbox:not([hidden])");
    assert.equal(await page.locator('.rh-lightbox-close[aria-label="Close"]').count(), 1);
    await page.locator(".rh-lightbox-img").dblclick();
    assert.equal(await page.locator(".rh-lightbox-img").evaluate((img) => img.style.getPropertyValue("--rh-zoom")), "2");
    await page.locator(".rh-lightbox-img").dblclick();
    assert.equal(await page.locator(".rh-lightbox-img").evaluate((img) => img.style.getPropertyValue("--rh-zoom")), "1");
    await page.locator(".rh-lightbox-img").hover();
    await page.mouse.wheel(0, -100);
    assert(Number(await page.locator(".rh-lightbox-img").evaluate((img) => img.style.getPropertyValue("--rh-zoom"))) > 1, "image wheel zoom should remain active");
    await page.keyboard.press("Escape");
    await page.waitForSelector(".rh-lightbox", { state: "detached" });
    assert.equal(await sourceImage.evaluate((img) => img === img.getRootNode().activeElement), true, "image Escape should restore source focus");
    await sourceImage.click();
    await page.waitForSelector(".rh-lightbox:not([hidden])");
    await page.click('.rh-lightbox-close[aria-label="Close"]');
    await page.waitForSelector(".rh-lightbox", { state: "detached" });
    assert.equal(await sourceImage.evaluate((img) => img === img.getRootNode().activeElement), true, "image close button should restore source focus");
    await pastedImage.evaluate((img) => img.click());
    assert.deepEqual(await page.locator(".rh-lightbox-img").evaluate((img) => {
      const style = getComputedStyle(img);
      return { pasted: img.dataset.rhPasted || null, padding: style.paddingTop,
        background: style.backgroundColor, border: style.borderTopWidth };
    }), { pasted: "1", padding: "0px", background: "rgba(0, 0, 0, 0)", border: "0px" },
    "the pasted marker should exempt the lightbox image from the dark-theme matte");
    await page.keyboard.press("Escape");

    await page.click("#t-share");
    await page.waitForSelector("#sharemenu.visible");
    const downloadPromise = page.waitForEvent("download");
    await page.click("#sm-export");
    const download = await downloadPromise;
    const downloadPath = await download.path();
    assert(downloadPath, "snapshot download should expose artifact bytes");
    const snapshotHtml = await fs.readFile(downloadPath, "utf8");

    const payloadText = extractSnapshotPayload(snapshotHtml);
    const projection = validatePortableProjection(JSON.parse(payloadText));
    assert.equal(snapshotHtml.split(SNAPSHOT_PAYLOAD_OPEN).length - 1, 1, "snapshot should contain exactly one inert payload");
    assertIncludes(snapshotHtml, "RabbitholeFrozenClient.startPortableSnapshot", "snapshot should use derived portable hydration");
    assert.deepEqual(Object.keys(projection.assets), ["diagram.png", "paste-deadbeef.png"], "snapshot should embed referenced assets only");
    assert.equal(projection.assets["diagram.png"], referencedBytes.toString("base64"));
    assert.equal(projection.assets["paste-deadbeef.png"], pastedBytes.toString("base64"));
    assert.equal(projection.hole.nodes.find((node) => node.id === "pending")?.markdown, "half-streamed markdown must not escape", "browser snapshots preserve the saved article text without a live generation transport");

    const frozenPage = await browser.newPage();
    try {
      await frozenPage.setContent(snapshotHtml, { waitUntil: "load" });
      await frozenPage.waitForSelector('.rh-img-frame img[alt="Pasted image"]', { state: "attached" });
      await frozenPage.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
      assert.deepEqual(await frozenPage.locator('.rh-img-frame img[alt="Pasted image"]').locator("..").evaluate((frame) => {
        const style = getComputedStyle(frame);
        return { pasted: frame.dataset.rhPasted || null, padding: style.paddingTop,
          background: style.backgroundColor, border: style.borderTopWidth };
      }), { pasted: "1", padding: "0px", background: "rgba(0, 0, 0, 0)", border: "0px" },
      "the frozen/share runtime should mount the pasted marker and preserve the matte exemption");
      assert.equal(await frozenPage.locator('.rh-img-frame img[alt="diagram"]').locator("..").evaluate((frame) =>
        getComputedStyle(frame).paddingTop), "8px", "the frozen/share runtime should retain ordinary-image mattes");
    } finally {
      await frozenPage.close();
    }
    console.log("ok image ux: browser share snapshot download is canonical and portable");
  } finally {
    await browser.close();
    await app.close();
  }
}

await runMarkdownSmoke();
await runPageFixtures();
await runLiveSnapshotDownload();
console.log("image experience verification passed");
