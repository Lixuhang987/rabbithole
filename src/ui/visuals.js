// ===========================================================================
// VISUAL FENCES
// ===========================================================================
import { getBlockType } from "../core/blocks.js";
import { normalizeBlockAnchor } from "../core/hole/anchor.js";
import { iconSvg } from "../core/html/icons.js";
import { BUTTON_OPEN } from "../core/html/markup.js";
import { escapeHtml } from "../core/utils.js";
import { createCleanupScope } from "./kit/scope.js";
import { disposeLightbox, openLightbox } from "./lightbox.js";
import { visualStylesFor } from "./visual-style-runtime.js";

let visualSurfaceCaches = {};
const blockMounts = {};
const mountedVisuals = new Set();
let mermaidRuntimePromise = null;
let mermaidRenderQueue = Promise.resolve();
let mermaidRenderId = 0;
let mermaidControllers = [];
let mermaidThemeObserver = null;
let mermaidGeneration = 0;
const utf8Decoder = typeof TextDecoder === "function" ? new TextDecoder("utf-8") : null;

function loadEmbeddedMermaidRuntime() {
  if (window.mermaid) return window.mermaid;
  const carrier = document.getElementById("rabbithole-mermaid-runtime");
  if (!carrier || !carrier.textContent) throw new Error("Mermaid runtime is unavailable");
  const script = document.createElement("script");
  script.setAttribute("data-rabbithole-runtime", "mermaid");
  script.textContent = carrier.textContent;
  (document.head || document.body || document.documentElement).appendChild(script);
  script.remove();
  if (!window.mermaid) throw new Error("Mermaid runtime failed to initialize");
  return window.mermaid;
}

function defaultVisualHooks() {
  return {
    post: function () {
      return Promise.resolve({ ok: true });
    },
    getNode: function () {
      return null;
    },
    getBlockBranches: function () {
      return [];
    },
    openBranch: function () {},
    askSelection: function () {
      return false;
    },
    canAsk: function () {
      return false;
    },
    loadMermaid: loadEmbeddedMermaidRuntime,
  };
}
/** @type {any} */
let visualHooks = defaultVisualHooks();
let visualHooksReady = false;
const VISUAL_ALLOWED_URI =
  /^(?:(?:https?:)?\/\/|https?:|\/|\.\/|\.\.\/|#|data:image\/(?:png|jpe?g|gif|webp);base64,|[^:]*$)/i;
const VISUAL_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ADD_TAGS: ["style"],
  ADD_ATTR: ["style"],
  FORCE_BODY: true,
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form"],
  FORBID_ATTR: ["srcdoc"],
  ALLOWED_URI_REGEXP: VISUAL_ALLOWED_URI,
};
export function initVisuals(hooks) {
  visualHooks = Object.assign(defaultVisualHooks(), hooks || {});
}
export function disposeVisuals() {
  for (const mounted of mountedVisuals) mounted.__rhVisualDispose?.();
  mountedVisuals.clear();
  for (let i = 0; i < mermaidControllers.length; i++) mermaidControllers[i].dispose();
  disposeLightbox();
  visualSurfaceCaches = {};
  visualHooks = defaultVisualHooks();
  mermaidRuntimePromise = null;
  mermaidRenderQueue = Promise.resolve();
  mermaidControllers = [];
  mermaidGeneration += 1;
  if (mermaidThemeObserver) mermaidThemeObserver.disconnect();
  mermaidThemeObserver = null;
}
export function registerBlockMount(type, mountSpec) {
  const key = String(type || "").toLowerCase();
  const descriptor = getBlockType(key);
  if (!descriptor) throw new Error('Cannot register mount for unknown block type "' + key + '"');
  if (!mountSpec || typeof mountSpec !== "object")
    throw new TypeError('Block mount for "' + key + '" must be an object');
  if (descriptor.security === "sanitize-html" && typeof mountSpec.renderHtml !== "function") {
    throw new TypeError('Block mount for "' + key + '" must provide renderHtml(model)');
  }
  if (mountSpec.wire !== undefined && typeof mountSpec.wire !== "function") {
    throw new TypeError('Block mount wire for "' + key + '" must be a function');
  }
  const selectionCapabilities = ["wireSelection", "packContext", "paintMark"];
  const supplied = selectionCapabilities.filter((name) => mountSpec[name] !== undefined);
  if (supplied.length && supplied.length !== selectionCapabilities.length) {
    throw new TypeError('Askable block mount for "' + key + '" must provide wireSelection, packContext, and paintMark');
  }
  for (const name of supplied) {
    if (typeof mountSpec[name] !== "function")
      throw new TypeError("Block mount " + name + ' for "' + key + '" must be a function');
  }
  blockMounts[key] = mountSpec;
}
function ensureVisualSanitizer() {
  const purifier = window.DOMPurify;
  if (!purifier || typeof purifier.sanitize !== "function") throw new Error("DOMPurify is unavailable");
  if (!visualHooksReady && typeof purifier.addHook === "function") {
    purifier.addHook("uponSanitizeAttribute", function (node, data) {
      if (data && data.attrName && /^on/i.test(data.attrName)) data.keepAttr = false;
    });
    visualHooksReady = true;
  }
  return purifier;
}
function sanitizeVisualSource(source) {
  return ensureVisualSanitizer().sanitize(source, VISUAL_SANITIZE_CONFIG);
}
function decodeVisualSource(encoded) {
  const bin = atob(String(encoded || ""));
  if (utf8Decoder) {
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return utf8Decoder.decode(bytes);
  }
  try {
    return decodeURIComponent(escape(bin));
  } catch (e) {
    return bin;
  }
}
function visualCacheKey(type, encoded) {
  return String(type || "") + "\n" + String(encoded || "");
}
function visualFallback(source, message) {
  const wrap = document.createElement("div");
  wrap.className = "viz-fallback";
  const note = document.createElement("div");
  note.className = "viz-fallback-note";
  note.textContent = message || "Unable to render visual. Showing source.";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = String(source || "");
  pre.appendChild(code);
  wrap.appendChild(note);
  wrap.appendChild(pre);
  return wrap;
}

function liveRange(candidate) {
  if (!candidate) return null;
  if (typeof candidate.cloneRange === "function") return candidate.cloneRange();
  try {
    const range = document.createRange();
    range.setStart(candidate.startContainer, candidate.startOffset);
    range.setEnd(candidate.endContainer, candidate.endOffset);
    return range;
  } catch (error) {
    return null;
  }
}

function rangeInsideRoot(range, root) {
  return !!range && !!root?.contains && root.contains(range.startContainer) && root.contains(range.endContainer);
}

function compactSelectedText(value) {
  return String(value ?? "")
    .replace(/\r\n?|\n/g, "")
    .trim();
}

function shadowAwareSelection(root) {
  const shadow = root?.getRootNode?.();
  const documentSelection = window.getSelection?.();
  const candidates = [];
  if (documentSelection?.getComposedRanges) {
    try {
      candidates.push(...documentSelection.getComposedRanges({ shadowRoots: shadow?.host ? [shadow] : [] }));
    } catch (error) {
      try {
        candidates.push(...documentSelection.getComposedRanges(shadow?.host ? shadow : undefined));
      } catch (nestedError) {}
    }
  }
  const shadowSelection = shadow?.getSelection?.();
  if (shadowSelection && !shadowSelection.isCollapsed) {
    for (let index = 0; index < shadowSelection.rangeCount; index++) candidates.push(shadowSelection.getRangeAt(index));
  }
  if (documentSelection && !documentSelection.isCollapsed) {
    for (let index = 0; index < documentSelection.rangeCount; index++)
      candidates.push(documentSelection.getRangeAt(index));
  }
  for (const candidate of candidates) {
    const range = liveRange(candidate);
    if (!rangeInsideRoot(range, root)) continue;
    const text = compactSelectedText(range.toString());
    if (text) return { text, range };
  }
  return null;
}

function coarsePointer() {
  try {
    return !!window.matchMedia?.("(pointer: coarse)").matches;
  } catch (error) {
    return false;
  }
}

function virtualRangeAnchor(range, contextElement) {
  return {
    contextElement,
    getBoundingClientRect: function () {
      return range.getBoundingClientRect();
    },
  };
}

function captureBlockAsk(root, context, mountSpec, selection) {
  const selectedText = compactSelectedText(selection?.text);
  if (!selectedText || !context.block_id || !context.canAsk()) return false;
  const packed = mountSpec.packContext({ selected_text: selectedText }, context);
  if (!packed?.block) return false;
  const anchor = selection.range
    ? virtualRangeAnchor(selection.range, root)
    : {
        contextElement: root,
        getBoundingClientRect: function () {
          return selection.element.getBoundingClientRect();
        },
      };
  return context.askSelection({
    parentId: context.node_id,
    selectedText,
    blockAnchor: packed.block,
    anchorRectEl: anchor,
    range: selection.range || null,
  });
}

function wireTextSelection(root, context, mountSpec, coarseTextElement) {
  if (!root?.addEventListener || !context.canAsk()) return function () {};
  let start = null;
  function onPointerdown(event) {
    if (
      event.button !== 0 ||
      event.isPrimary === false ||
      event.target.closest?.(".rh-viz-mark, button, a, input, textarea, select")
    ) {
      start = null;
      return;
    }
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function onPointerup(event) {
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const dragged = dx * dx + dy * dy >= 25;
    start = null;
    const selected = shadowAwareSelection(root);
    if (selected && captureBlockAsk(root, context, mountSpec, selected)) {
      if (!dragged) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (!dragged && coarsePointer()) {
      const element = coarseTextElement(event.target, root);
      const text = String(element?.textContent || "").trim();
      if (element && text && captureBlockAsk(root, context, mountSpec, { text, element })) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  }
  function onPointercancel() {
    start = null;
  }
  root.addEventListener("pointerdown", onPointerdown, true);
  root.addEventListener("pointerup", onPointerup, true);
  root.addEventListener("pointercancel", onPointercancel, true);
  return function () {
    root.removeEventListener("pointerdown", onPointerdown, true);
    root.removeEventListener("pointerup", onPointerup, true);
    root.removeEventListener("pointercancel", onPointercancel, true);
  };
}

function mermaidTextElement(target, root) {
  const element = target?.closest?.("text");
  return element && root.contains(element) ? element : null;
}

function showTextElement(target, root) {
  let element = target?.nodeType === 1 ? target : target?.parentElement;
  while (element && element !== root) {
    if (
      !element.matches?.("style, script, button, a, input, textarea, select") &&
      element.childElementCount === 0 &&
      String(element.textContent || "").trim()
    )
      return element;
    element = element.parentElement;
  }
  return null;
}

function packBlockContext(selection, context) {
  return { block: normalizeBlockAnchor({ block_id: context.block_id, selected_text: selection.selected_text }) };
}

function paintBlockMark(root, _model, context) {
  const frame = root?.closest?.(".rh-viz-frame");
  if (!frame) return;
  const branches = context.getBranches();
  let chip = frame.querySelector(".rh-viz-mark");
  if (!branches.length) {
    chip?.remove();
    return;
  }
  if (!chip) {
    chip = document.createElement("button");
    chip.type = "button";
    chip.className = "rh-viz-mark";
    chip.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      const current = context.getBranches();
      const branch = current[current.length - 1];
      if (branch) context.openBranch(branch.id);
    });
    frame.appendChild(chip);
  }
  chip.textContent = String(branches.length);
  chip.title =
    branches.length === 1
      ? "Open answer from this visual"
      : `Open latest of ${branches.length} answers from this visual`;
  chip.setAttribute("aria-label", chip.title);
  chip.dataset.child = branches[branches.length - 1].id;
}

export function refreshVisualMarks(nodeId, blockId = "") {
  for (const mounted of mountedVisuals) {
    const record = mounted.__rhVisualMount;
    if (!record || record.context.node_id !== nodeId || (blockId && record.context.block_id !== blockId)) continue;
    record.mountSpec.paintMark?.(record.content, record.model, record.context);
  }
}

function buildShowVisual(model) {
  return String(model == null ? "" : model);
}

function cloneShowVisual(content) {
  const host = document.createElement("div");
  host.className = "rh-lightbox-show";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = visualStylesFor("show");
  const frame = document.createElement("div");
  frame.className = "rh-viz-frame";
  const clone = content.cloneNode(true);
  clone.classList.add("rh-viz-content");
  frame.appendChild(clone);
  shadow.append(style, frame);
  return host;
}

function openShowLightbox(content, context, mountSpec, trigger) {
  let selectionCleanup = function () {};
  return openLightbox({
    content: cloneShowVisual(content),
    label: "Visual",
    trigger,
    variant: "diagram",
    selectionEnabled: true,
    onContentChange: function (host) {
      selectionCleanup();
      const root = host.shadowRoot?.querySelector(".rh-viz-content");
      selectionCleanup = root ? mountSpec.wireSelection(root, context, mountSpec) : function () {};
    },
    onClose: function () {
      selectionCleanup();
    },
  });
}

function wireShowSurface(root, _model, context, mountSpec) {
  if (!root?.addEventListener) return function () {};
  const frame = root.closest?.(".rh-viz-frame");
  const expand = document.createElement("button");
  expand.type = "button";
  expand.className = "rh-visual-expand rh-show-expand";
  expand.setAttribute("aria-label", "Open visual fullscreen");
  expand.title = "Open fullscreen";
  expand.innerHTML = iconSvg("expand");
  frame?.appendChild(expand);
  let start = null;
  function onPointerdown(event) {
    if (
      event.button !== 0 ||
      event.isPrimary === false ||
      event.target.closest?.("button, a, input, textarea, select, .rh-viz-mark")
    )
      return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function onPointerup(event) {
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (dx * dx + dy * dy >= 25 || shadowAwareSelection(root)) return;
    openShowLightbox(root, context, mountSpec, expand);
  }
  function onPointercancel() {
    start = null;
  }
  root.addEventListener("pointerdown", onPointerdown);
  root.addEventListener("pointerup", onPointerup);
  root.addEventListener("pointercancel", onPointercancel);
  expand.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    openShowLightbox(root, context, mountSpec, expand);
  });
  return function () {
    root.removeEventListener("pointerdown", onPointerdown);
    root.removeEventListener("pointerup", onPointerup);
    root.removeEventListener("pointercancel", onPointercancel);
    expand.remove();
  };
}

function buildMermaidVisual() {
  return '<div class="rh-mermaid" role="img" aria-label="Mermaid diagram"><span class="rh-mermaid-loading">Drawing diagram…</span></div>';
}

function currentMermaidTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default";
}

function loadMermaidRuntime() {
  if (!mermaidRuntimePromise) {
    mermaidRuntimePromise = Promise.resolve()
      .then(function () {
        return visualHooks.loadMermaid();
      })
      .then(function (runtime) {
        if (!runtime || typeof runtime.initialize !== "function" || typeof runtime.render !== "function") {
          throw new Error("Mermaid runtime does not expose initialize() and render()");
        }
        return runtime;
      })
      .catch(function (error) {
        mermaidRuntimePromise = null;
        throw error;
      });
  }
  return mermaidRuntimePromise;
}

function showMermaidFallback(target, source) {
  target.textContent = "";
  target.classList.remove("is-rendered");
  target.removeAttribute("role");
  target.removeAttribute("aria-label");
  target.appendChild(visualFallback(source, "Mermaid could not render this diagram. Showing source."));
}

function mermaidAccessibleName(svg) {
  return (
    String(svg.getAttribute("aria-label") || svg.querySelector("title")?.textContent || "Mermaid diagram").trim() ||
    "Mermaid diagram"
  );
}

function cloneMermaidSvg(svg) {
  const clone = svg.cloneNode(true);
  clone.removeAttribute("width");
  clone.removeAttribute("height");
  clone.style.removeProperty("width");
  clone.style.removeProperty("height");
  clone.style.removeProperty("max-width");
  clone.setAttribute("preserveAspectRatio", "xMidYMid meet");
  clone.classList.add("rh-lightbox-diagram");
  return clone;
}

function openMermaidLightbox(controller, target, trigger) {
  const svg = target.querySelector("svg");
  if (!svg || !target.classList.contains("is-rendered")) return;
  const label = mermaidAccessibleName(svg);
  let selectionCleanup = function () {};
  controller.lightbox = openLightbox({
    content: cloneMermaidSvg(svg),
    label: label,
    trigger: trigger,
    variant: "diagram",
    selectionEnabled: true,
    onContentChange: function (content) {
      selectionCleanup();
      selectionCleanup = controller.mountSpec.wireSelection(content, controller.context, controller.mountSpec);
    },
    onClose: function () {
      selectionCleanup();
    },
  });
}

function mountMermaidAffordance(controller, target, svg) {
  target.classList.add("is-rendered");
  target.removeAttribute("role");
  target.removeAttribute("aria-label");
  let button = target.querySelector("button.rh-mermaid-expand");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "rh-visual-expand rh-mermaid-expand";
    button.setAttribute("aria-label", "Open diagram fullscreen");
    button.title = "Open fullscreen";
    button.innerHTML = iconSvg("expand");
    button.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      openMermaidLightbox(controller, target, button);
    });
    target.appendChild(button);
  }
  if (controller.lightbox && controller.lightbox.isOpen()) {
    controller.lightbox.replaceContent(cloneMermaidSvg(svg));
  }
}

function wireMermaidSurface(controller, target) {
  let start = null;
  function onPointerdown(e) {
    start = null;
    if (
      !target.classList.contains("is-rendered") ||
      e.button !== 0 ||
      e.isPrimary === false ||
      e.target.closest?.(".rh-mermaid-expand")
    )
      return;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  function onPointerup(e) {
    if (!start || start.id !== e.pointerId) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (dx * dx + dy * dy >= 25) return;
    const button = target.querySelector("button.rh-mermaid-expand");
    if (button) openMermaidLightbox(controller, target, button);
  }
  function onPointercancel() {
    start = null;
  }
  target.addEventListener("pointerdown", onPointerdown);
  target.addEventListener("pointerup", onPointerup);
  target.addEventListener("pointercancel", onPointercancel);
  return function () {
    target.removeEventListener("pointerdown", onPointerdown);
    target.removeEventListener("pointerup", onPointerup);
    target.removeEventListener("pointercancel", onPointercancel);
  };
}

function trackMermaidController(controller) {
  mermaidControllers.push(controller);
  if (mermaidThemeObserver || typeof MutationObserver !== "function") return;
  mermaidThemeObserver = new MutationObserver(function () {
    const live = [];
    for (let i = 0; i < mermaidControllers.length; i++) {
      const current = mermaidControllers[i];
      if (current.root && current.root.isConnected !== false) {
        live.push(current);
        current.render();
      }
    }
    mermaidControllers = live;
  });
  mermaidThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function wireMermaid(root, source, context, mountSpec) {
  const target = root.querySelector(".rh-mermaid");
  let renderVersion = 0;
  const generation = mermaidGeneration;
  const controller = {
    root: root,
    context: context,
    mountSpec: mountSpec,
    lightbox: null,
    dispose: function () {},
    render: function () {
      const version = ++renderVersion;
      mermaidRenderQueue = mermaidRenderQueue.then(async function () {
        try {
          const runtime = await loadMermaidRuntime();
          if (generation !== mermaidGeneration || version !== renderVersion || !target) return;
          runtime.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            htmlLabels: false,
            suppressErrorRendering: true,
            theme: currentMermaidTheme(),
            flowchart: { htmlLabels: false, useMaxWidth: true },
            sequence: { useMaxWidth: true },
          });
          const result = await runtime.render("rh-mermaid-" + ++mermaidRenderId, String(source || ""));
          if (generation !== mermaidGeneration || version !== renderVersion || !target) return;
          const rendered = document.createElement("div");
          rendered.innerHTML = sanitizeVisualSource((result && result.svg) || "");
          const svg = rendered.querySelector("svg");
          if (!svg) throw new Error("Mermaid produced no SVG");
          svg.setAttribute("role", "img");
          if (!svg.getAttribute("aria-label")) svg.setAttribute("aria-label", "Mermaid diagram");
          const previous = target.querySelector("svg");
          if (previous && target.classList.contains("is-rendered")) previous.replaceWith(svg);
          else {
            target.textContent = "";
            target.appendChild(svg);
          }
          mountMermaidAffordance(controller, target, svg);
        } catch (e) {
          if (generation === mermaidGeneration && version === renderVersion && target)
            showMermaidFallback(target, source);
        }
      });
    },
  };
  controller.dispose = wireMermaidSurface(controller, target);
  trackMermaidController(controller);
  controller.render();
}

function buildMountedVisual(descriptor, mountSpec, model, context) {
  const host = /** @type {any} */ (document.createElement("div"));
  host.className = "viz-mounted viz-" + descriptor.type;
  host.setAttribute("data-viz-mounted", descriptor.type);
  if (context.block_id) host.setAttribute("data-block-id", context.block_id);
  host.style.contain = descriptor.type === "mermaid" ? "layout style" : "content";
  context.host = host;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = visualStylesFor(descriptor.type);
  const frame = document.createElement("div");
  frame.className = "rh-viz-frame";
  const content = document.createElement("div");
  content.className = "rh-viz-content";
  if (descriptor.security === "sanitize-html") {
    content.innerHTML = sanitizeVisualSource(mountSpec.renderHtml(model));
  } else {
    content.textContent = descriptor.toPlainText(model);
  }
  frame.appendChild(content);
  shadow.appendChild(style);
  shadow.appendChild(frame);
  const scope = createCleanupScope();
  if (mountSpec.wireSelection && context.canAsk()) {
    const cleanup = mountSpec.wireSelection(content, context, mountSpec);
    if (typeof cleanup === "function") scope.addCleanup(cleanup);
  }
  if (mountSpec.wire) {
    const cleanup = mountSpec.wire(content, model, context, mountSpec);
    if (typeof cleanup === "function") scope.addCleanup(cleanup);
  }
  mountSpec.paintMark?.(content, model, context);
  host.__rhVisualMount = { mountSpec, content, model, context };
  host.__rhVisualDispose = function () {
    scope.dispose();
    mountedVisuals.delete(host);
  };
  mountedVisuals.add(host);
  return host;
}
function getSurfaceCache(surfaceKey) {
  const key = String(surfaceKey || "default");
  if (!visualSurfaceCaches[key]) visualSurfaceCaches[key] = {};
  return visualSurfaceCaches[key];
}
export function mountVisuals(containerEl, surfaceKey) {
  if (!containerEl || !containerEl.querySelectorAll) return;
  const placeholders = containerEl.querySelectorAll(".viz");
  if (!placeholders.length) {
    if (surfaceKey && visualSurfaceCaches[surfaceKey]) visualSurfaceCaches[surfaceKey] = {};
    return;
  }
  const cache = getSurfaceCache(surfaceKey);
  const present = {};
  const idCounts = {};
  const used = {};
  const mountable = [];
  for (let i = 0; i < placeholders.length; i++) {
    const ph = placeholders[i];
    if (ph.classList && ph.classList.contains("viz-pending")) continue;
    const type = String(ph.getAttribute("data-viz") || "").toLowerCase();
    const encoded = ph.getAttribute("data-src") || "";
    if (!type || !encoded) continue;
    const blockId = ph.getAttribute("data-block-id") || "";
    const key = blockId ? "id\n" + blockId : visualCacheKey(type, encoded);
    if (blockId) idCounts[blockId] = (idCounts[blockId] || 0) + 1;
    present[key] = (present[key] || 0) + 1;
    mountable.push({ el: ph, type: type, encoded: encoded, key: key, blockId: blockId });
  }
  for (let d = 0; d < mountable.length; d++) {
    const candidate = mountable[d];
    if (candidate.blockId && idCounts[candidate.blockId] > 1) {
      present[candidate.key] -= 1;
      candidate.key = visualCacheKey(candidate.type, candidate.encoded);
      present[candidate.key] = (present[candidate.key] || 0) + 1;
      candidate.blockId = "";
    }
  }
  for (let m = 0; m < mountable.length; m++) {
    let item = mountable[m];
    const idx = used[item.key] || 0;
    used[item.key] = idx + 1;
    if (!cache[item.key]) cache[item.key] = [];
    let mounted = cache[item.key][idx];
    const signature = visualCacheKey(item.type, item.encoded);
    if (mounted && mounted.__rhVisualSignature !== signature) {
      mounted.__rhVisualDispose?.();
      mounted = null;
    }
    if (!mounted) {
      const descriptor = getBlockType(item.type);
      const mountSpec = blockMounts[item.type];
      let source;
      try {
        source = decodeVisualSource(item.encoded);
      } catch (e) {
        mounted = visualFallback("", "Unable to decode visual source.");
      }
      if (!mounted)
        try {
          const nodeId = String(
            (item.el.closest && item.el.closest("[data-node-id]")?.getAttribute("data-node-id")) ||
              (item.key &&
                String(surfaceKey || "")
                  .split(":")
                  .slice(1)
                  .join(":")) ||
              "",
          );
          const node = visualHooks.getNode(nodeId);
          const learn = node && node.progress;
          const currentState = item.blockId && learn && typeof learn === "object" ? learn[item.blockId] : null;
          const context = {
            node_id: nodeId,
            block_id: item.blockId,
            state: currentState && typeof currentState === "object" ? currentState : {},
            canAsk: function () {
              return !!item.blockId && !!nodeId && visualHooks.canAsk();
            },
            askSelection: function (options) {
              return visualHooks.askSelection(options);
            },
            getBranches: function () {
              return visualHooks.getBlockBranches(nodeId, item.blockId);
            },
            openBranch: function (branchId) {
              return visualHooks.openBranch(branchId);
            },
            recordBlockState: function (nextState) {
              if (!item.blockId || !nodeId) return Promise.resolve({ ok: true });
              if (node) {
                node.progress = node.progress && typeof node.progress === "object" ? node.progress : {};
                node.progress[item.blockId] = Object.assign({}, node.progress[item.blockId] || {}, nextState);
              }
              return Promise.resolve(
                visualHooks.post({ type: "block_state", node_id: nodeId, block_id: item.blockId, state: nextState }),
              );
            },
          };
          mounted =
            descriptor && mountSpec
              ? buildMountedVisual(descriptor, mountSpec, descriptor.parse(source), context)
              : visualFallback(source, "Unsupported visual type. Showing source.");
        } catch (e) {
          mounted = visualFallback(source, "Unable to render visual. Showing source.");
        }
      mounted.__rhVisualSignature = signature;
      cache[item.key][idx] = mounted;
    }
    if (item.el.parentNode) item.el.parentNode.replaceChild(mounted, item.el);
  }
  for (const ckey in cache) {
    if (!Object.prototype.hasOwnProperty.call(cache, ckey)) continue;
    if (!present[ckey]) {
      for (const mounted of cache[ckey]) mounted?.__rhVisualDispose?.();
      delete cache[ckey];
    } else {
      for (let index = present[ckey]; index < cache[ckey].length; index++) cache[ckey][index]?.__rhVisualDispose?.();
      cache[ckey].length = present[ckey];
    }
  }
}

const showMount = {
  renderHtml: buildShowVisual,
  wire: wireShowSurface,
  wireSelection: function (root, context, mountSpec) {
    return wireTextSelection(root, context, mountSpec, showTextElement);
  },
  packContext: packBlockContext,
  paintMark: paintBlockMark,
};
const mermaidMount = {
  renderHtml: buildMermaidVisual,
  wire: wireMermaid,
  wireSelection: function (root, context, mountSpec) {
    return wireTextSelection(root, context, mountSpec, mermaidTextElement);
  },
  packContext: packBlockContext,
  paintMark: paintBlockMark,
};
registerBlockMount("show", showMount);
registerBlockMount("mermaid", mermaidMount);

export function buildCheckVisual(model) {
  const options = model.options
    .map(function (option, index) {
      return (
        BUTTON_OPEN +
        ' class="rh-check-option" type="button" data-option="' +
        index +
        '">' +
        escapeHtml(option ?? "") +
        "</button>"
      );
    })
    .join("");
  return (
    '<section class="rh-check"><div class="rh-check-question">' +
    escapeHtml(model.question ?? "") +
    '</div><div class="rh-check-options">' +
    options +
    '</div><div class="rh-check-explanation" hidden>' +
    escapeHtml(model.explanation || "") +
    '</div><div class="rh-check-actions" hidden>' +
    BUTTON_OPEN +
    ' class="rh-check-reset" type="button">Try again</button></div></section>'
  );
}

function wireCheck(root, model, ctx) {
  const options = Array.from(root.querySelectorAll(".rh-check-option"));
  const explanation = root.querySelector(".rh-check-explanation");
  const actions = root.querySelector(".rh-check-actions");
  const reset = root.querySelector(".rh-check-reset");
  const state = ctx && ctx.state && typeof ctx.state === "object" ? ctx.state : {};
  let attempts = Number.isInteger(state.attempts) && state.attempts >= 0 ? state.attempts : 0;
  let currentLast = state.last || null;
  function paint(last, revealed) {
    options.forEach(function (button, index) {
      button.disabled = !!revealed;
      button.classList.remove("is-correct", "is-incorrect");
      button.removeAttribute("aria-pressed");
      if (revealed && last && index === last.option) {
        button.classList.add(last.correct ? "is-correct" : "is-incorrect");
        button.setAttribute("aria-pressed", "true");
      }
      if (revealed && index === model.answer) button.classList.add("is-correct");
    });
    explanation.hidden = !revealed;
    actions.hidden = !revealed;
  }
  paint(state.last, state.revealed === true);
  options.forEach(function (button, index) {
    button.addEventListener("click", function () {
      if (button.disabled) return;
      attempts += 1;
      const last = { option: index, correct: index === model.answer };
      currentLast = last;
      paint(last, true);
      if (ctx) ctx.recordBlockState({ attempts: attempts, last: last, revealed: true });
    });
  });
  reset.addEventListener("click", function () {
    paint(null, false);
    options[0]?.focus();
    if (ctx) ctx.recordBlockState({ attempts: attempts, last: currentLast, revealed: false });
  });
}

registerBlockMount("check", { renderHtml: buildCheckVisual, wire: wireCheck });
