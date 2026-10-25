import { systemClock } from "../../core/clock.js";
import { composerHasDraft } from "../composer-state.js";
import { childrenOf, currentNodeId, mode, nodes, rootId, shouldReduceMotion } from "../core.js";
import { EASE_OUT_MOTION_CSS } from "../easing.js";
import { autoTidyEnabled, autoTidyGraceSeconds, onPreferenceChange } from "../preferences.js";
import { isSettingsSheetOpen } from "../settings-sheet.js";
import { createAutoLayout } from "./auto-layout.js";
import { computeRibs, decideAutoTidyFolds, retimeRibs } from "./auto-tidy-policy.js";
import { setBranchCollapsed, windowBranch } from "./fold.js";
import { nodePin } from "./pins.js";
import { r } from "./runtime.js";

const SWEEP_MS = 5000;
const GLIDE_MS = 320;

export function createAutoTidy(options) {
  const attention = options.attention;
  const clock = normalizeAutoTidyClock(options.clock);
  let warmId = currentNodeId || rootId;
  let coldSince = new Map();
  let pausedAt = 0;
  let sweepTimer = /** @type {ReturnType<typeof setInterval> | 0} */ (0);
  let enabled = false;
  let disposed = false;
  const glides = new Map();
  const autoFoldProvenance = new Map();
  const autoLayout = createAutoLayout({
    clock,
    anchorId: () => warmId,
    canRun: () => !paused() && !r.activePointerGestures.size && !isSettingsSheetOpen(),
    beforeLayout: () => Array.from(glides.keys()).forEach(finishGlide),
  });

  function nowForWarmth() {
    return pausedAt || clock.now();
  }

  function currentRibs() {
    if (!nodes[warmId]) warmId = nodes[rootId] ? rootId : null;
    return warmId ? computeRibs(warmId, nodes, childrenOf) : [];
  }

  function retime(now, includeNewCollapsed) {
    let ribs = currentRibs();
    if (!includeNewCollapsed)
      ribs = ribs.filter(function (id) {
        return coldSince.has(id) || !nodes[id]?.collapsed;
      });
    coldSince = retimeRibs(ribs, coldSince, now);
  }

  function warm(id) {
    warmId = nodes[id] ? id : rootId;
    retime(nowForWarmth(), true);
  }

  function paused() {
    return document.hidden || !document.hasFocus() || mode !== "canvas";
  }

  function syncPause() {
    const now = clock.now();
    if (paused()) {
      if (!pausedAt) pausedAt = now;
      return;
    }
    if (!pausedAt) return;
    const away = now - pausedAt;
    coldSince.forEach(function (stamp, id) {
      coldSince.set(id, stamp + away);
    });
    pausedAt = 0;
  }

  function nodeHasDraft(node) {
    return !!node?.ncText && composerHasDraft({ text: node.ncText });
  }

  function finishGlide(card) {
    const glide = glides.get(card);
    if (!glide) return;
    glides.delete(card);
    if (glide.frame) cancelAnimationFrame(glide.frame);
    if (glide.timer) clock.clearTimeout(glide.timer);
    card.removeEventListener("transitionend", glide.onEnd);
    card.style.transition = "";
    card.style.transform = "";
  }

  function glideCard(card, dx, dy) {
    finishGlide(card);
    const glide = {
      frame: 0,
      timer: /** @type {ReturnType<typeof setTimeout> | 0} */ (0),
      onEnd: /** @type {((event: TransitionEvent) => void) | null} */ (null),
    };
    glide.onEnd = function (event) {
      if (event.propertyName === "transform") finishGlide(card);
    };
    glides.set(card, glide);
    card.style.transition = "none";
    card.style.transform = "translate(" + dx + "px," + dy + "px)";
    card.getBoundingClientRect();
    glide.frame = requestAnimationFrame(function () {
      glide.frame = 0;
      if (!glides.has(card)) return;
      card.addEventListener("transitionend", glide.onEnd);
      card.style.transition = "transform " + GLIDE_MS + "ms " + EASE_OUT_MOTION_CSS;
      card.style.transform = "translate(0px,0px)";
      glide.timer = clock.setTimeout(function () {
        finishGlide(card);
      }, GLIDE_MS + 40);
    });
  }

  function fold(rib, decision, now) {
    const before = new Map();
    const branch = windowBranch(rib);
    branch.forEach(function (node) {
      if (!node.el) return;
      finishGlide(node.el);
      before.set(node.id, node.el.getBoundingClientRect());
    });
    setBranchCollapsed(rib, true);
    autoFoldProvenance.set(rib.id, { foldedAt: now, reason: decision.reason });
    if (shouldReduceMotion()) return;
    branch.forEach(function (node) {
      const card = node.el;
      const first = before.get(node.id);
      if (!card || !first || card.style.display === "none") return;
      const last = card.getBoundingClientRect();
      const dx = first.left - last.left;
      const dy = first.top - last.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) glideCard(card, dx, dy);
    });
  }

  function sweep() {
    if (!enabled || disposed) return;
    syncPause();
    if (pausedAt || r.activePointerGestures.size || isSettingsSheetOpen()) return;
    const now = clock.now();
    retime(now, false);
    const decisions = decideAutoTidyFolds(currentRibs(), coldSince, nodes, childrenOf, now, {
      graceMs: autoTidyGraceSeconds() * 1000,
      hoveredCardId: attention.getHoveredCardId(),
      nodePinned: nodePin,
      nodeHasDraft: nodeHasDraft,
    });
    decisions.forEach(function (decision) {
      const rib = nodes[decision.id];
      if (!rib) return;
      fold(rib, decision, now);
      coldSince.delete(decision.id);
    });
  }

  function start() {
    if (sweepTimer) return;
    sweepTimer = clock.setInterval(sweep, SWEEP_MS);
  }

  function stop() {
    if (!sweepTimer) return;
    clock.clearInterval(sweepTimer);
    sweepTimer = 0;
  }

  function syncEnabled() {
    const next = autoTidyEnabled();
    if (next === enabled) return;
    enabled = next;
    autoLayout.setEnabled(enabled);
    if (!enabled) {
      stop();
      return;
    }
    coldSince = retimeRibs(currentRibs(), new Map(), nowForWarmth());
    start();
  }

  function engageCard(id) {
    if (!id || !nodes[id]) return;
    const card = nodes[id]?.el;
    if (card) finishGlide(card);
    syncPause();
    warm(id);
  }

  function modeChanged(nextMode) {
    syncPause();
    if (nextMode === "canvas") warm(currentNodeId || rootId);
  }

  function branchExpanded(id) {
    const provenance = autoFoldProvenance.get(id);
    if (!provenance) return;
    autoFoldProvenance.delete(id);
    if (clock.now() - provenance.foldedAt <= 10000) {
      console.debug("auto-tidy: false fold", id, provenance.reason);
    }
  }

  document.addEventListener("visibilitychange", syncPause);
  window.addEventListener("blur", syncPause);
  window.addEventListener("focus", syncPause);
  const stopAttention = attention.onEngage(engageCard);
  const stopPreferences = onPreferenceChange(function (kind) {
    if (kind === "auto-tidy") syncEnabled();
  });
  syncPause();
  syncEnabled();

  return {
    layoutChanged: autoLayout.changed,
    layoutEnabled: () => enabled,
    branchExpanded: branchExpanded,
    modeChanged: modeChanged,
    dispose: function () {
      if (disposed) return;
      disposed = true;
      stop();
      autoLayout.dispose();
      stopAttention();
      stopPreferences();
      document.removeEventListener("visibilitychange", syncPause);
      window.removeEventListener("blur", syncPause);
      window.removeEventListener("focus", syncPause);
      autoFoldProvenance.clear();
      Array.from(glides.keys()).forEach(finishGlide);
    },
  };
}

function normalizeAutoTidyClock(clock) {
  return {
    now: () => (typeof clock?.now === "function" ? clock.now() : systemClock.now()),
    setInterval: (callback, delay) =>
      typeof clock?.setInterval === "function" ? clock.setInterval(callback, delay) : setInterval(callback, delay),
    clearInterval: (handle) =>
      typeof clock?.clearInterval === "function" ? clock.clearInterval(handle) : clearInterval(handle),
    setTimeout: (callback, delay) =>
      typeof clock?.setTimeout === "function" ? clock.setTimeout(callback, delay) : setTimeout(callback, delay),
    clearTimeout: (handle) =>
      typeof clock?.clearTimeout === "function" ? clock.clearTimeout(handle) : clearTimeout(handle),
  };
}

export function notifyAutoTidyModeChanged(nextMode) {
  r.canvasMaintenance?.modeChanged(nextMode);
}
