import assert from "node:assert/strict";

const DEFAULT_ROOT = ".card .doc-content[data-node-id]";

/**
 * Fail before Playwright spends its global action timeout on a selection
 * surface that the product has deliberately made non-interactive.
 * @param {import("playwright").Page} page
 */
export async function assertSelectionPopoverUsable(page) {
  const state = await page.locator("#ask").evaluate((surface) => {
    const rect = surface.getBoundingClientRect();
    const viewport = window.visualViewport;
    const bounds = {
      left: viewport?.offsetLeft || 0,
      top: viewport?.offsetTop || 0,
      right: (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth),
      bottom: (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight),
    };
    return {
      anchorHidden: surface.hasAttribute("data-anchor-hidden"),
      intersects: rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      viewport: bounds,
    };
  });
  assert.equal(state.anchorHidden, false, `selection popover anchor must be visible before interaction: ${JSON.stringify(state)}`);
  assert.equal(state.intersects, true, `selection popover must intersect the viewport before interaction: ${JSON.stringify(state)}`);
}

async function waitForCanvasView(page) {
  await page.evaluate(async () => {
    const wait = window.__rabbitholeTest?.waitForCanvasViewSettled;
    if (typeof wait !== "function") throw new Error("Rabbithole's canvas-view settle seam is unavailable");
    await wait();
  });
}

async function nextFrame(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

async function waitForSelectionSurfaceAnimations(page) {
  await page.locator("#ask").evaluate(async (surface) => {
    const running = surface
      .getAnimations({ subtree: true })
      .filter((animation) => animation.playState === "running" && animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(running.map((animation) => animation.finished.catch(() => {})));
  });
}

async function settleCanvasAndLayout(page) {
  await waitForCanvasView(page);
  // Drain layout work that was already queued by the preceding UI action
  // catch any camera glide it starts.
  await nextFrame(page);
  await waitForCanvasView(page);
}

function normalizedSpec(options) {
  if (!options || typeof options.text !== "string" || !options.text) {
    throw new TypeError("selectVisibleText requires non-empty text");
  }
  return {
    text: options.text,
    rootSelector: options.rootSelector || DEFAULT_ROOT,
    exact: !!options.exact,
    start: Number.isInteger(options.start) ? options.start : null,
    end: Number.isInteger(options.end) ? options.end : null,
    anchorMovesWithCanvas: options.anchorMovesWithCanvas !== false,
  };
}

async function scrollSelectionTargetIntoView(page, spec) {
  await page.evaluate(({ text, rootSelector, exact }) => {
    const root = document.querySelector(rootSelector);
    if (!root) throw new Error(`Selection root not found: ${rootSelector}`);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || "";
      if (exact ? value !== text : !value.includes(text)) continue;
      const target = node.parentElement || root;
      target.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
      return;
    }
    throw new Error(`Selection text not found: ${text}`);
  }, spec);
}

async function waitForTargetCardTransition(page, spec) {
  await page.evaluate(async ({ text, rootSelector, exact }) => {
    const root = document.querySelector(rootSelector);
    if (!root) throw new Error(`Selection root not found: ${rootSelector}`);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || "";
      if (exact ? value !== text : !value.includes(text)) continue;
      const card = node.parentElement?.closest(".card");
      const running = card?.getAnimations().filter((animation) => animation.playState === "running") || [];
      await Promise.all(running.map((animation) => animation.finished.catch(() => {})));
      return;
    }
    throw new Error(`Selection text not found: ${text}`);
  }, spec);
}

/**
 * Move the canvas by screen pixels through its real background-drag gesture.
 * @param {import("playwright").Page} page
 * @param {{ x: number, y: number }} movement
 */
export async function panCanvasBy(page, movement) {
  return page.evaluate(({ x, y }) => {
    if (!x && !y) return { x: 0, y: 0 };
    const surface = document.getElementById("viewport");
    if (!surface) throw new Error("Canvas viewport not found");
    const bounds = surface.getBoundingClientRect();
    const startX = bounds.left + bounds.width / 2;
    const startY = bounds.top + bounds.height / 2;
    window.__rhSelectionPointerId = (window.__rhSelectionPointerId || 7000) + 1;
    const pointerId = window.__rhSelectionPointerId;
    const fire = (type, clientX, clientY, buttons) =>
      surface.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons,
          clientX,
          clientY,
        }),
      );
    fire("pointerdown", startX, startY, 1);
    fire("pointermove", startX + x, startY + y, 1);
    fire("pointerup", startX + x, startY + y, 0);
    return { x, y };
  }, movement);
}

async function selectAndReveal(page, spec) {
  const result = await page.evaluate(async ({ text, rootSelector, exact, start, end, anchorMovesWithCanvas }) => {
    function viewportRect() {
      const viewport = window.visualViewport;
      const left = viewport ? viewport.offsetLeft : 0;
      const top = viewport ? viewport.offsetTop : 0;
      const width = viewport ? viewport.width : window.innerWidth;
      const height = viewport ? viewport.height : window.innerHeight;
      return { left, top, right: left + width, bottom: top + height };
    }
    function movableClipBounds(element) {
      let left = -Infinity;
      let top = -Infinity;
      let right = Infinity;
      let bottom = Infinity;
      let clipped = false;
      let current = element;
      while (current && current !== document.body && current !== document.documentElement) {
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(current).overflow)) {
          if (current.id !== "viewport") {
            const rect = current.getBoundingClientRect();
            if (rect.left > left) left = rect.left;
            if (rect.top > top) top = rect.top;
            if (rect.right < right) right = rect.right;
            if (rect.bottom < bottom) bottom = rect.bottom;
            clipped = true;
          }
        }
        current = current.parentElement;
      }
      return clipped ? { left, top, right, bottom } : null;
    }
    function intersects(rect, clip) {
      return rect.left < clip.right && rect.right > clip.left && rect.top < clip.bottom && rect.bottom > clip.top;
    }
    const root = document.querySelector(rootSelector);
    if (!root) throw new Error(`Selection root not found: ${rootSelector}`);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue || "";
      const index = exact ? (value === text ? 0 : -1) : value.indexOf(text);
      if (index === -1) continue;
      const rangeStart = start == null ? index : start;
      const rangeEnd = end == null ? index + text.length : end;
      if (rangeStart < 0 || rangeEnd <= rangeStart || rangeEnd > value.length) {
        throw new Error(`Invalid selection offsets ${rangeStart}:${rangeEnd} for ${JSON.stringify(value)}`);
      }
      const range = document.createRange();
      range.setStart(node, rangeStart);
      range.setEnd(node, rangeEnd);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);

      const rect = range.getBoundingClientRect();
      const viewport = viewportRect();
      const context = root.closest(".doc-content") || root;
      const clip = await window.__rabbitholeTest.selectionAnchorClipBounds(context);
      if (!clip || intersects(rect, clip)) return { text: selection.toString(), movement: { x: 0, y: 0 } };
      if (!document.body.classList.contains("mode-canvas")) {
        throw new Error(`Selection remained clipped outside canvas mode: ${JSON.stringify({ rect, clip })}`);
      }

      let movement;
      if (anchorMovesWithCanvas) {
        const canvas = document.getElementById("viewport")?.getBoundingClientRect();
        const target = canvas
          ? {
              left: Math.max(viewport.left, canvas.left),
              top: Math.max(viewport.top, canvas.top),
              right: Math.min(viewport.right, canvas.right),
              bottom: Math.min(viewport.bottom, canvas.bottom),
            }
          : viewport;
        movement = {
          x: (target.left + target.right) / 2 - (rect.left + rect.right) / 2,
          y: (target.top + target.bottom) / 2 - (rect.top + rect.bottom) / 2,
        };
      } else {
        const contentClip = movableClipBounds(context);
        if (!contentClip || !Number.isFinite(contentClip.left + contentClip.top + contentClip.right + contentClip.bottom)) {
          throw new Error("A fixed selection rect needs a movable clipping ancestor");
        }
        movement = {
          x: (rect.left + rect.right) / 2 - (contentClip.left + contentClip.right) / 2,
          y: (rect.top + rect.bottom) / 2 - (contentClip.top + contentClip.bottom) / 2,
        };
      }
      return { text: selection.toString(), movement };
    }
    throw new Error(`Selection text not found: ${text}`);
  }, spec);
  const movement = await panCanvasBy(page, result.movement);
  return { text: result.text, movement };
}

async function validateAndMouseUp(page, spec, movement) {
  return page.evaluate(async ({ rootSelector, movement }) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) throw new Error("Text selection collapsed before mouseup");
    const range = selection.getRangeAt(0);
    const context = document.querySelector(rootSelector)?.closest(".doc-content") || document.querySelector(rootSelector);
    if (!context) throw new Error(`Selection root not found: ${rootSelector}`);
    const clip = await window.__rabbitholeTest.selectionAnchorClipBounds(context);
    const rect = range.getBoundingClientRect();
    const visible = rect.left < clip.right && rect.right > clip.left && rect.top < clip.bottom && rect.bottom > clip.top;
    if (!visible) {
      throw new Error(`Selection is outside its anchor clip after settling: ${JSON.stringify({
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        clip,
        movement,
      })}`);
    }
    const selectedText = selection.toString();
    const target = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    (target || context).dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.left, clientY: rect.top }));
    return { text: selectedText, pan: movement };
  }, { rootSelector: spec.rootSelector, movement });
}

/**
 * Programmatically select text with the same preconditions a real selection
 * has: stationary content, nested-scroll visibility, and strict intersection
 * with the engine's visual-viewport/overflow clip.
 * @param {import("playwright").Page} page
 * @param {{ text: string, rootSelector?: string, exact?: boolean, start?: number, end?: number, anchorMovesWithCanvas?: boolean }} options
 */
export async function selectVisibleText(page, options) {
  const spec = normalizedSpec(options);
  await settleCanvasAndLayout(page);
  await scrollSelectionTargetIntoView(page, spec);
  await nextFrame(page);
  await waitForCanvasView(page);
  await waitForTargetCardTransition(page, spec);
  const selected = await selectAndReveal(page, spec);
  await nextFrame(page);
  await waitForCanvasView(page);
  const result = await validateAndMouseUp(page, spec, selected.movement);
  // Opening the composer auto-grows its textarea after the initial anchor
  // position. The surface ResizeObserver schedules the corrected position on
  // the frame after that size change. Its finite entrance transition also
  // changes the measured bounding box, so wait on the animation itself.
  await nextFrame(page);
  await waitForSelectionSurfaceAnimations(page);
  await nextFrame(page);
  const hidden = await page.locator("#ask").getAttribute("data-anchor-hidden");
  if (hidden !== null) throw new Error("Selection popover became hidden after mouseup");
  return result;
}
