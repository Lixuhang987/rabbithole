import { mode, nodes } from "../core.js";
import { isComposingText, isTypingTarget } from "../input-intent.js";
import { createCleanupScope } from "../kit/scope.js";
import { hasOpenLayer } from "../overlay/layer-stack.js";
import { openNode } from "../reader.js";

/** One display-only excerpt; the source header alone owns its hover lifetime. */
export function createFoldedPreview() {
  const scope = createCleanupScope();
  let active = null;
  let lifetime = null;
  let preview = null;
  let mouseX = 0;
  let mouseY = 0;

  function headerAt(target) {
    if (mode !== "canvas" || document.hidden || hasOpenLayer()) return null;
    if (!(target instanceof Element) || target.closest("button, a, input, textarea, select, [contenteditable]"))
      return null;
    const head = target.closest(".card-head");
    const card = head?.parentElement;
    const node = card && nodes[card.dataset.id];
    if (!node || node.el !== card || !node.collapsed || !node.bodyEl?.querySelector(".origin-context")) return null;
    return head;
  }

  function stillHovered() {
    return active?.isConnected && headerAt(document.elementFromPoint(mouseX, mouseY)) === active;
  }

  function close() {
    lifetime?.dispose();
    lifetime = null;
    preview?.remove();
    preview = null;
    active = null;
  }

  function open() {
    if (!stillHovered()) return close();
    const node = nodes[active.parentElement.dataset.id];
    preview = document.createElement("section");
    preview.className = "folded-preview";
    preview.inert = true;
    preview.setAttribute("aria-hidden", "true");
    const clip = document.createElement("div");
    clip.className = "folded-preview-clip";
    const hint = document.createElement("div");
    hint.className = "folded-preview-hint";
    hint.textContent = "Tab · Expand document";
    preview.append(clip, hint);
    document.body.appendChild(preview);

    function measure() {
      if (!stillHovered()) return close();
      const content = clip.firstElementChild;
      preview.classList.toggle("clipped", !!content && content.scrollHeight > clip.clientHeight + 1);
    }

    let queued = false;
    function refresh() {
      if (queued) return;
      queued = true;
      lifetime.raf(function () {
        queued = false;
        if (!stillHovered()) return close();
        clip.replaceChildren(clonePreviewBody(node));
        measure();
      });
    }
    clip.appendChild(clonePreviewBody(node));
    lifetime.listen(clip, "load", measure, true);
    lifetime.listen(window, "resize", measure);
    if (typeof ResizeObserver === "function") lifetime.observe(new ResizeObserver(measure), clip);
    lifetime.observe(new MutationObserver(refresh), node.el, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    // Card removal, a replaced document or reader entry can happen without a
    // pointer event. Observe connectivity separately from content refreshes.
    lifetime.observe(
      new MutationObserver(function () {
        if (!stillHovered()) close();
      }),
      document.body,
      { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "open"] },
    );
    measure();
  }

  function onPointer(event) {
    if (event.pointerType !== "mouse") return;
    mouseX = event.clientX;
    mouseY = event.clientY;
    const head =
      !event.buttons && window.matchMedia("(hover: hover) and (pointer: fine)").matches ? headerAt(event.target) : null;
    if (head === active) return;
    close();
    if (!head) return;
    active = head;
    lifetime = createCleanupScope();
    lifetime.timeout(open, 300);
  }

  scope.listen(document, "pointerover", onPointer);
  scope.listen(document, "pointermove", onPointer);
  scope.listen(document, "pointerout", function (event) {
    if (active && headerAt(event.relatedTarget) !== active) close();
  });
  scope.listen(document, "pointerdown", close, true);
  scope.listen(document, "contextmenu", close, true);
  scope.listen(document, "wheel", close, { capture: true, passive: true });
  scope.listen(window, "blur", close);
  scope.listen(document, "visibilitychange", close);
  scope.listen(
    document,
    "keydown",
    function (event) {
      if (!preview || !stillHovered() || event.defaultPrevented || isTypingTarget(event) || isComposingText(event))
        return;
      if (event.key === "Escape") return close();
      if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.repeat)
        return;
      const id = active.parentElement.dataset.id;
      event.preventDefault();
      event.stopPropagation();
      close();
      openNode(id);
    },
    true,
  );
  scope.addCleanup(close);
  return { dispose: scope.dispose };
}

/** Copy the already-rendered document without mounting another live surface. */
function clonePreviewBody(node) {
  const source = node.bodyEl;
  const clone = source.cloneNode(true);
  clone.className = "folded-preview-content";
  copyRenderedMedia(source, clone);
  const ids = new Map();
  clone.querySelectorAll("[id]").forEach(function (element, index) {
    const id = "folded-preview-" + index;
    ids.set(element.id, id);
    element.id = id;
  });
  clone.querySelectorAll("*").forEach(function (element) {
    element.removeAttribute("data-node-id");
    element.removeAttribute("data-surface");
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "id") continue;
      const value = attribute.value.replace(/#([\w:-]+)/g, function (match, id) {
        return ids.has(id) ? "#" + ids.get(id) : match;
      });
      if (value !== attribute.value) element.setAttribute(attribute.name, value);
    }
    if (element.classList.contains("doc-content")) element.style.removeProperty("font-size");
  });
  clone.querySelectorAll(".code-copy, .rh-img-handle, .note-dots, .nc-handle").forEach(function (element) {
    element.remove();
  });
  return clone;
}

// cloneNode omits shadow trees and canvas pixels. Copy their current rendered
// state as well, without registering media controllers or interactive handlers.
function copyRenderedMedia(source, clone) {
  const originals = source.querySelectorAll("*");
  clone.querySelectorAll("*").forEach(function (element, index) {
    const original = originals[index];
    if (original.shadowRoot) {
      const shadow = element.attachShadow({ mode: "open" });
      shadow.append(...Array.from(original.shadowRoot.childNodes, (child) => child.cloneNode(true)));
      shadow.adoptedStyleSheets = original.shadowRoot.adoptedStyleSheets;
      copyRenderedMedia(original.shadowRoot, shadow);
    }
    if (element instanceof HTMLCanvasElement && original.width && original.height)
      element.getContext("2d")?.drawImage(original, 0, 0);
  });
}
