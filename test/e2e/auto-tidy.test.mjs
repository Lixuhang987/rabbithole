/** @protects auto-tidy live canvas behavior, settings, and frozen exclusion. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { routeProvider, seedConfiguredBridge } from "../support/provider-mock.mjs";
import { bootWebApp } from "../support/web-app-harness.mjs";
import { assertSelectionPopoverUsable, panCanvasBy, selectVisibleText } from "../support/visible-selection.mjs";

const app = await bootWebApp();
const alphaQuote = "Alpha anchor " + "完整引用内容需要保留。".repeat(24) + "引用结束。";
const alphaQuestion = "Why alpha?\n" + "完整提问需要保留。".repeat(25) + "<literal-question-end>";
const longScrollAnswer = Array.from({ length: 90 }, (_, index) => "Paragraph " + (index + 1) + " keeps this card scrollable.").join("\n\n");

try {
  const context = await app.browser.newContext();
  await seedConfiguredBridge(context);
  await context.addInitScript(() => {
    localStorage.setItem("rh-auto-tidy", "on");
    localStorage.setItem("rh-auto-tidy-grace", "5");
  });
  const page = await context.newPage();
  const debugMessages = [];
  page.on("console", (message) => {
    if (message.type() === "debug") debugMessages.push(message.text());
  });
  await routeProvider(page, {
    streams: [
      ["TITLE: Alpha branch\n", "Alpha branch answer."],
      ["TITLE: Alpha descendant\n", "Alpha descendant answer."],
      ["TITLE: Gamma branch\n", "Gamma branch answer."],
      ["TITLE: Delta branch\n", longScrollAnswer],
      ["TITLE: Beta branch\n", "Beta branch answer."],
    ],
  });
  await page.goto(app.baseUrl, { waitUntil: "networkidle" });

  await createDocument(page, "# Auto-tidy fixture\n\n" + alphaQuote + "\n\nBeta anchor grows its sibling.\n\nGamma anchor stays unread.\n\nDelta anchor has scrollable content.");
  await page.locator("#t-settings").click();
  assert.deepEqual(
    await page.locator("[data-settings-section]").allInnerTexts(),
    ["Appearance", "Canvas", "Quick questions", "Model"],
    "Canvas settings sit between Appearance and Quick questions in the live host",
  );
  assert.equal(await page.locator('[data-reading-step="-1"]').evaluate((button) =>
    button.previousElementSibling?.matches("[data-reading-reset]")), true,
  "the Appearance Reset precedes A− so appearing never shifts the reading-size stepper");
  await page.getByRole("tab", { name: "Canvas" }).click();
  assert.equal(await page.locator('[data-tidy-step="-1"]').evaluate((button) =>
    button.previousElementSibling?.matches("[data-tidy-reset]")), true,
  "the Canvas Reset precedes − so appearing never shifts the grace stepper");
  const switchControl = page.locator("[data-tidy-enabled]");
  const graceRow = page.locator("#settings-tidy-grace-row");
  const graceValue = page.locator("[data-tidy-value]");
  assert.equal(await switchControl.isChecked(), true);
  assert.equal(await graceValue.innerText(), "5 s");
  await page.locator('[data-tidy-step="1"]').click();
  assert.equal(await graceValue.innerText(), "30 s", "an off-ladder value snaps in the pressed direction");
  assert.equal(await page.locator('[data-tidy-step="-1"]').isDisabled(), true);
  for (const expected of ["1 min", "2 min", "5 min", "10 min"]) {
    await page.locator('[data-tidy-step="1"]').click();
    assert.equal(await graceValue.innerText(), expected);
  }
  assert.equal(await page.locator('[data-tidy-step="1"]').isDisabled(), true);
  assert.equal(await page.locator("[data-tidy-reset]").isVisible(), true);
  await page.locator("[data-tidy-reset]").click();
  assert.equal(await graceValue.innerText(), "2 min");
  assert.equal(await page.locator("[data-tidy-reset]").isVisible(), false);
  await switchControl.uncheck();
  assert.equal(await graceRow.evaluate((row) => row.classList.contains("settings-sheet-row-disabled")), true);
  assert.equal(await page.locator('[data-tidy-step="-1"]').isDisabled(), true);
  assert.equal(await page.locator('[data-tidy-step="1"]').isDisabled(), true);
  await switchControl.check();
  await page.locator("[data-settings-close]").click();

  await page.evaluate(() => localStorage.setItem("rh-auto-tidy-grace", "5"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".card.root .doc-content");

  await askFromSelection(page, alphaQuote, alphaQuestion);
  const alpha = page.locator('.card:not(.root)', { hasText: "Alpha branch answer." });
  await alpha.waitFor();
  const alphaId = await alpha.getAttribute("data-id");
  await assertCompleteOrigin(alpha, alphaQuote, alphaQuestion);
  await alpha.locator(".nc-handle").focus();
  await page.keyboard.press("Enter");
  await alpha.locator(".nc-inner textarea").fill("Add an Alpha descendant.");
  await alpha.locator(".nc-inner textarea").press("Control+Enter");
  const alphaDescendant = page.locator('.card:not(.root)', { hasText: "Alpha descendant answer." });
  await alphaDescendant.waitFor();
  await alphaDescendant.locator(".card-title").click();
  await askFromSelection(page, "Gamma anchor", "Why gamma?");
  const gamma = page.locator('.card:not(.root)', { hasText: "Gamma branch answer." });
  await gamma.waitFor();
  const gammaId = await gamma.getAttribute("data-id");
  await askFromSelection(page, "Delta anchor", "Why delta?");
  const delta = page.locator('.card:not(.root)', { hasText: "Paragraph 90 keeps this card scrollable." });
  await delta.waitFor();
  const deltaId = await delta.getAttribute("data-id");
  const deltaBody = delta.locator(".card-body");
  assert.equal(
    await deltaBody.evaluate((body) => body.scrollHeight > body.clientHeight),
    true,
    "the wheel fixture must have content the card can consume",
  );
  await deltaBody.hover();
  await page.mouse.wheel(0, 240);
  await page.waitForFunction((id) => {
    const card = document.querySelector('.card[data-id="' + id + '"] .card-body');
    return card && card.scrollTop > 0;
  }, deltaId);

  await page.waitForTimeout(220);
  await page.evaluate((id) => {
    const viewport = document.getElementById("viewport");
    const card = document.querySelector('.card[data-id="' + id + '"] .card-title');
    viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40 }));
    card.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 40 }));
  }, gammaId);
  await askFromSelection(page, "Beta anchor", "Why beta?");
  const beta = page.locator('.card:not(.root)', { hasText: "Beta branch answer." });
  await beta.waitFor();
  const betaId = await beta.getAttribute("data-id");
  // Real keyboard focus engages the card even when the transformed canvas has
  // put its header outside the viewport; forced clicks can hit another card.
  async function engageBeta() {
    await beta.locator(".card-more").focus();
  }

  await engageBeta();
  // One real-clock smoke covers the browser interval integration. The
  // exemption matrix below advances the injected clock without wall time.
  await page.waitForFunction(
    ([alphaNodeId, deltaNodeId]) => [alphaNodeId, deltaNodeId].every((id) =>
      document.querySelector('.card[data-id="' + id + '"]')?.classList.contains("collapsed")),
    [alphaId, deltaId],
    { timeout: 12000 },
  );
  assert.equal(await beta.evaluate((card) => card.classList.contains("collapsed")), false, "the touched spine stays open");
  assert.equal(await page.locator(".card.root").evaluate((card) => card.classList.contains("collapsed")), false);
  assert.equal(await gamma.evaluate((card) => card.classList.contains("collapsed")), false, "an answered but never-engaged branch stays open");
  const gammaStored = await waitForStoredNode(page, gammaId, (node) => node.collapsed !== true);
  assert.equal(gammaStored.extensions.attention, undefined, "canvas panning over a card does not mark it seen");
  const deltaStored = await waitForStoredNode(page, deltaId, (node) => node.collapsed === true);
  assert.equal(!!deltaStored.extensions.attention?.seen_at, true, "a consumed card wheel marks its card seen");
  const storedFold = await waitForStoredNode(page, alphaId, (node) => node.collapsed === true);
  assert.equal(storedFold.collapsed, true, "auto-tidy persists folded cards using the shared layered layout");

  await assertCompleteOrigin(alpha, alphaQuote, alphaQuestion);
  const layoutGeometry = await page.evaluate(([parentId, childId]) => {
    const parent = document.querySelector('.card[data-id="' + parentId + '"]');
    const child = document.querySelector('.card[data-id="' + childId + '"]');
    const body = parent.querySelector(".card-body");
    return { layered: parseFloat(child.style.left) > parseFloat(parent.style.left) + parent.offsetWidth,
      scrollable: body.scrollHeight > body.clientHeight + 1 };
  }, [alphaId, await alphaDescendant.getAttribute("data-id")]);
  assert.deepEqual(layoutGeometry, { layered: true, scrollable: false }, "compact folded headers keep descendants in a depth column");

  await toggleBranch(alpha);
  await page.waitForSelector('.card[data-id="' + alphaId + '"]:not(.collapsed)');
  assert.equal(
    debugMessages.some((message) => message === "auto-tidy: false fold " + alphaId + " grace_elapsed"),
    true,
    "expanding a recent auto-fold emits its reason through the false-fold tuning signal",
  );
  await page.waitForFunction(async (id) => {
    const hole = await window.__rabbitholeTest.readStoredHole();
    return hole.nodes.find((node) => node.id === id)?.collapsed === false;
  }, alphaId);
  await page.addInitScript(installAutoTidyClock);
  await page.reload({ waitUntil: "networkidle" });
  await advanceAutoTidyClock(page, 11_000);
  await page.waitForSelector('.card[data-id="' + alphaId + '"].collapsed');
  assert.equal(await gamma.evaluate((card) => card.classList.contains("collapsed")), false, "reload keeps an unread sibling protected");
  await assertCompleteOrigin(alpha, alphaQuote, alphaQuestion);
  const reloadedAlpha = await waitForStoredNode(page, alphaId, (node) => node.collapsed === true);
  assert.equal(!!reloadedAlpha.extensions.attention?.seen_at, true, "seen state survives reload before the new session clock elapses");

  await toggleBranch(alpha);
  await page.waitForSelector('.card[data-id="' + alphaId + '"]:not(.collapsed)');
  await engageBeta();
  await alpha.evaluate((card) => card.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  await advanceAutoTidyClock(page, 11_000);
  assert.equal(await alpha.evaluate((card) => card.classList.contains("collapsed")), false, "hover defers a due fold");
  await alpha.evaluate((card) => card.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body })));
  await advanceAutoTidyClock(page, 5_000);
  await page.waitForSelector('.card[data-id="' + alphaId + '"].collapsed');

  await toggleBranch(alpha);
  await alpha.locator(".card-more").evaluate((button) => button.click());
  await page.locator("#cm-pin").evaluate((button) => button.click());
  await engageBeta();
  await advanceAutoTidyClock(page, 11_000);
  assert.equal(await alpha.evaluate((card) => card.classList.contains("collapsed")), false, "a pinned card exempts its branch");

  await page.locator('.pinned-window-card[data-id="' + alphaId + '"] .pinned-pin').evaluate((button) => button.click());
  await alpha.locator(".nc-handle").evaluate((button) => button.click());
  await setComposerDraft(alpha, "Unsent draft protects this branch");
  await engageBeta();
  await advanceAutoTidyClock(page, 11_000);
  assert.equal(await alpha.evaluate((card) => card.classList.contains("collapsed")), false, "an unsent card-composer draft exempts its branch");

  await page.locator("#t-settings").click();
  await page.getByRole("tab", { name: "Canvas" }).click();
  await page.locator("[data-tidy-enabled]").uncheck();
  await page.locator("[data-settings-close]").click();
  await setComposerDraft(alpha, "");
  await engageBeta();
  await advanceAutoTidyClock(page, 11_000);
  assert.equal(await alpha.evaluate((card) => card.classList.contains("collapsed")), false, "turning the mode off stops future folds");

  await alpha.locator(".card-collapse").evaluate((button) => button.click());
  await assertCompleteOrigin(alpha, alphaQuote, alphaQuestion);
  const frozenHtml = await page.evaluate(() => window.__rabbitholeTest.exportSnapshot());
  assert.equal(frozenHtml.includes("rh-auto-tidy"), false, "the frozen client does not contain the engine or preference");
  assert.equal(
    frozenHtml.includes("Folds branches you've moved on from."),
    false,
    "the frozen client does not contain Canvas settings copy",
  );
  const frozenPage = await context.newPage();
  await frozenPage.setContent(frozenHtml, { waitUntil: "load" });
  const frozenAlpha = frozenPage.locator('.card[data-id="' + alphaId + '"]');
  await assertCompleteOrigin(frozenAlpha, alphaQuote, alphaQuestion);
  await frozenAlpha.locator('[aria-label="Expand document"]').evaluate((button) => button.click());
  await assertCompleteOrigin(frozenPage.locator(".reader-context"), alphaQuote, alphaQuestion);
  await frozenPage.locator("#t-settings").click();
  assert.deepEqual(
    await frozenPage.locator("[data-settings-section]").allInnerTexts(),
    ["Appearance", "Quick questions"],
    "frozen settings never register the Canvas section",
  );
  await frozenPage.close();
  await context.close();

  assert(betaId, "the fixture retains the warm branch identity");
  await verifyEnableMidSession(app);
} finally {
  await app.close();
}

async function createDocument(page, markdown) {
  const previous = await page.evaluate(() => window.__rabbitholeTest?.currentHoleId?.() || "");
  await page.evaluate((value) => window.__rabbitholeTest.createDocument(value), markdown);
  await page.waitForFunction((oldId) => {
    const id = window.__rabbitholeTest?.currentHoleId?.();
    return id && id !== oldId;
  }, previous);
  await page.waitForSelector(".card.root .doc-content[data-node-id]");
}

async function askFromSelection(page, text, question) {
  await selectVisibleText(page, {
    text,
    rootSelector: ".card.root .doc-content[data-node-id]",
  });
  await page.locator("#ask-text").fill(question);
  await assertSelectionPopoverUsable(page);
  await page.locator('#ask [data-commit="ask"]').click({ timeout: 4_000 });
}

async function waitForStoredNode(page, id, predicate) {
  const node = await page.evaluate(
    async (nodeId) => (await window.__rabbitholeTest.exportPortable()).hole.nodes.find((entry) => entry.id === nodeId),
    id,
  );
  assert(predicate(node), "stored node did not retain the folded state: " + JSON.stringify(node));
  return node;
}

async function toggleBranch(card) {
  await card.locator(".card-collapse").evaluate((button) => {
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 2 }));
    button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }));
  });
}

async function setComposerDraft(card, value) {
  await card.locator(".nc-inner textarea").evaluate((textarea, next) => {
    textarea.value = next;
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: next }));
  }, value);
}

async function verifyEnableMidSession(app) {
  const context = await app.browser.newContext();
  try {
    await seedConfiguredBridge(context);
    await context.addInitScript(installAutoTidyClock);
    await context.addInitScript(() => {
      localStorage.setItem("rh-auto-tidy-grace", "5");
    });
    const page = await context.newPage();
    await routeProvider(page, {
      streams: [
        ["TITLE: Read while off\n", "First answer read before enabling."],
        ["TITLE: Warm while off\n", "Second answer becomes the warm spine."],
      ],
    });
    await page.goto(app.baseUrl, { waitUntil: "networkidle" });
    await createDocument(page, "# Enable-mid-session fixture\n\nFirst anchor.\n\nSecond anchor.");

    await askFromSelection(page, "First anchor", "Why first?");
    const first = page.locator('.card:not(.root)', { hasText: "First answer read before enabling." });
    await first.waitFor();
    const firstId = await first.getAttribute("data-id");
    await waitForStoredStatus(page, firstId, "answered");
    await first.locator(".card-title").click();

    await askFromSelection(page, "Second anchor", "Why second?");
    const second = page.locator('.card:not(.root)', { hasText: "Second answer becomes the warm spine." });
    await second.waitFor();
    const secondId = await second.getAttribute("data-id");
    await waitForStoredStatus(page, secondId, "answered");
    await second.locator(".card-title").click();
    await page.waitForFunction(async (ids) => {
      const hole = await window.__rabbitholeTest.readStoredHole();
      return ids.every((id) => !!hole.nodes.find((node) => node.id === id)?.extensions.attention?.seen_at);
    }, [firstId, secondId]);
    assert.equal(await first.evaluate((card) => card.classList.contains("collapsed")), false);
    assert.equal(await second.evaluate((card) => card.classList.contains("collapsed")), false);

    await page.locator("#t-settings").click();
    await page.getByRole("tab", { name: "Canvas" }).click();
    assert.equal(await page.locator("[data-tidy-enabled]").isChecked(), false, "the journey starts with folding off");
    await page.locator("[data-tidy-enabled]").check();
    await page.locator("[data-settings-close]").click();
    await advanceAutoTidyClock(page, 1_000);
    assert.equal(
      await first.evaluate((card) => card.classList.contains("collapsed")),
      false,
      "enabling starts a fresh grace clock instead of backfilling elapsed time",
    );
    await advanceAutoTidyClock(page, 4_000);
    await page.waitForSelector('.card[data-id="' + firstId + '"].collapsed');
    assert.equal(
      await second.evaluate((card) => card.classList.contains("collapsed")),
      false,
      "the last card engaged while off becomes the warm spine when folding starts",
    );
  } finally {
    await context.close();
  }
}

async function waitForStoredStatus(page, id, status) {
  await page.waitForFunction(async (expected) => {
    const hole = await window.__rabbitholeTest.readStoredHole();
    return hole.nodes.find((node) => node.id === expected.id)?.status === expected.status;
  }, { id: id, status: status });
}

async function advanceAutoTidyClock(page, ms) {
  await page.evaluate((amount) => {
    const seam = window.__rabbitholeTest;
    if (typeof seam?.advanceAutoTidyClock === "function") return seam.advanceAutoTidyClock(amount);
    if (typeof seam?.autoTidyClock?.advance === "function") return seam.autoTidyClock.advance(amount);
    throw new Error("the auto-tidy clock seam is unavailable");
  }, ms);
}

function installAutoTidyClock() {
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  let now = Date.now();
  let nextHandle = 1;
  const intervals = new Map();
  const clock = {
    now: () => now,
    setInterval: (callback, delay) => {
      const handle = nextHandle++;
      const every = Math.max(1, Number(delay) || 0);
      intervals.set(handle, { callback, every, at: now + every });
      return handle;
    },
    clearInterval: (handle) => intervals.delete(handle),
    setTimeout: nativeSetTimeout,
    clearTimeout: nativeClearTimeout,
    advance: (ms) => {
      const target = now + Math.max(0, Number(ms) || 0);
      while (true) {
        let dueHandle = 0;
        let due = null;
        for (const [handle, interval] of intervals) {
          if (interval.at > target || (due && interval.at >= due.at)) continue;
          dueHandle = handle;
          due = interval;
        }
        if (!due) break;
        now = due.at;
        due.at += due.every;
        if (intervals.get(dueHandle) === due) due.callback();
      }
      now = target;
    },
  };
  window.__rabbitholeTest = { autoTidyClock: clock };
}

async function assertCompleteOrigin(surface, quote, question) {
  if (await surface.evaluate((element) => element.classList.contains("collapsed"))) {
    assert.equal(await surface.locator(".card-body").isVisible(), false, "folded cards expose only their compact header");
    const page = surface.page();
    const viewport = page.viewportSize();
    // Auto layout debounces for 400ms after a fold; wait for stable geometry
    // as well as the camera before moving a real pointer to its new header.
    await surface.evaluate((card) => new Promise((resolve) => {
      let previous = "", stableSince = performance.now();
      function sample(now) {
        const rect = card.getBoundingClientRect();
        const next = [rect.x, rect.y, rect.width, rect.height].join(":");
        if (next !== previous) { previous = next; stableSince = now; }
        if (now - stableSince >= 500) resolve();
        else requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    }));
    await page.evaluate(() => window.__rabbitholeTest?.waitForCanvasViewSettled?.());
    const box = await surface.locator(".card-head").boundingBox();
    await panCanvasBy(page, { x: viewport.width / 2 - box.x - box.width / 2,
      y: viewport.height / 2 - box.y - box.height / 2 });
    await page.evaluate(() => window.__rabbitholeTest?.waitForCanvasViewSettled?.());
    await page.mouse.move(2, 2);
    const titleBox = await surface.locator(".card-title").boundingBox();
    await page.mouse.move(titleBox.x + 15, titleBox.y + titleBox.height / 2);
    const preview = page.locator(".folded-preview");
    await preview.waitFor();
    assert.equal(await preview.locator(".origin-selection").textContent(), quote);
    assert.equal(await preview.locator(".origin-question").textContent(), question);
    assert.equal(await preview.locator(".doc-content").count(), 1, "hover includes the answer body as well as its origin");
    await page.mouse.move(2, 2);
    await preview.waitFor({ state: "detached" });
    return;
  }
  assert.equal(await surface.locator(".origin-selection").innerText(), quote);
  assert.equal(await surface.locator(".origin-question").innerText(), question);
  assert.equal(await surface.locator(".origin-selection").isVisible(), true);
  assert.equal(await surface.locator(".origin-question").isVisible(), true);
  assert.equal(await surface.locator(".origin-question").evaluate((element) => {
    const style = getComputedStyle(element);
    return style.whiteSpace === "pre-wrap" && style.overflowWrap === "anywhere";
  }), true, "full origin text wraps while retaining its line breaks");
}
