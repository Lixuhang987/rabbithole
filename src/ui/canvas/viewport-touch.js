import { systemClock } from "../../core/clock.js";
import { MAX_SCALE, MIN_SCALE, setViewAdjusted, view, viewport } from "../core.js";
import { applyTransform, cancelViewAnimation, screenToWorld } from "./camera.js";
import { r } from "./runtime.js";

// Touch has an explicit ownership contract:
// - one finger that starts in a card belongs to the card's native scroller;
// - one finger that starts on empty canvas pans the world 1:1;
// - two fingers anywhere own the camera and pinch around their midpoint.
// Keeping this in one state machine prevents a card drag, browser scroll, and
// canvas pan from each reacting to a different pointer in the same gesture.
export function initTouchViewportGestures() {
  const touches = new Map();
  let gesture = null;
  const PAN_SLOP = 3;
  function touchPoint(event) {
    return { id: event.pointerId, x: event.clientX, y: event.clientY };
  }
  function capture(pointerId) {
    try {
      viewport.setPointerCapture(pointerId);
    } catch (_e) {}
  }
  function release(pointerId) {
    try {
      viewport.releasePointerCapture(pointerId);
    } catch (_e) {}
  }
  function resetTouchGesture() {
    touches.forEach(function (_point, pointerId) {
      release(pointerId);
    });
    touches.clear();
    gesture = null;
    viewport.classList.remove("panning", "pinching");
  }
  function beginPan(point, active) {
    gesture = {
      kind: "pan",
      pointerId: point.id,
      sx: point.x,
      sy: point.y,
      ox: view.x,
      oy: view.y,
      active: !!active,
    };
    if (active) viewport.classList.add("panning");
  }
  function beginPinch() {
    const pair = Array.from(touches.values()).slice(0, 2);
    if (pair.length < 2) return;
    // A pinch wins over a card-head drag or resize that began with the first
    // finger. Their owned listeners are cancelled before the camera moves.
    r.activePointerGestures.forEach(function (cancel) {
      cancel();
    });
    r.lifecycle.hooks.hideAsk();
    cancelViewAnimation();
    capture(pair[0].id);
    capture(pair[1].id);
    const midX = (pair[0].x + pair[1].x) / 2;
    const midY = (pair[0].y + pair[1].y) / 2;
    const dx = pair[1].x - pair[0].x,
      dy = pair[1].y - pair[0].y;
    gesture = {
      kind: "pinch",
      ids: [pair[0].id, pair[1].id],
      distance: Math.max(1, Math.hypot(dx, dy)),
      scale: view.scale,
      anchor: screenToWorld(midX, midY),
    };
    r.suppressClickUntil = systemClock.now() + 450;
    viewport.classList.remove("panning");
    viewport.classList.add("pinching");
  }
  function onTouchDown(event) {
    if (event.pointerType !== "touch") return;
    if (touches.size >= 2) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const point = touchPoint(event);
    touches.set(event.pointerId, point);
    if (touches.size === 2) {
      beginPinch();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!(event.target.closest && event.target.closest(".card, .pinned-window"))) {
      r.lifecycle.hooks.hideAsk();
      cancelViewAnimation();
      capture(event.pointerId);
      beginPan(point, false);
      event.preventDefault();
      event.stopPropagation();
    } else {
      // Do not prevent this pointer: the card body keeps native one-finger
      // scrolling, momentum, text selection, and nested horizontal scrolling.
      gesture = { kind: "content", pointerId: event.pointerId };
    }
  }
  function onTouchMove(event) {
    if (event.pointerType !== "touch" || !touches.has(event.pointerId)) return;
    const point = touchPoint(event);
    touches.set(event.pointerId, point);
    if (!gesture) return;
    if (gesture.kind === "pinch") {
      const a = touches.get(gesture.ids[0]),
        b = touches.get(gesture.ids[1]);
      if (!a || !b) return;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (gesture.scale * Math.hypot(dx, dy)) / gesture.distance));
      const midX = (a.x + b.x) / 2,
        midY = (a.y + b.y) / 2;
      setViewAdjusted(true);
      view.scale = next;
      view.x = midX - gesture.anchor.x * next;
      view.y = midY - gesture.anchor.y * next;
      applyTransform();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (gesture.kind === "pan" && gesture.pointerId === event.pointerId) {
      const panX = point.x - gesture.sx,
        panY = point.y - gesture.sy;
      if (!gesture.active && Math.hypot(panX, panY) < PAN_SLOP) return;
      if (!gesture.active) {
        gesture.active = true;
        viewport.classList.add("panning");
        r.suppressClickUntil = systemClock.now() + 350;
      }
      setViewAdjusted(true);
      view.x = gesture.ox + panX;
      view.y = gesture.oy + panY;
      applyTransform();
      event.preventDefault();
      event.stopPropagation();
    }
  }
  function onTouchEnd(event) {
    if (event.pointerType !== "touch" || !touches.has(event.pointerId)) return;
    release(event.pointerId);
    touches.delete(event.pointerId);
    if (gesture && gesture.kind === "pinch" && touches.size === 1) {
      // Lifting one finger after a pinch should flow directly into a one-finger
      // camera pan instead of dropping the gesture or jumping the world.
      const remaining = Array.from(touches.values())[0];
      viewport.classList.remove("pinching");
      capture(remaining.id);
      beginPan(remaining, true);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!touches.size || (gesture && gesture.pointerId === event.pointerId)) resetTouchGesture();
  }
  function onTouchCancel(event) {
    if (event.pointerType !== "touch") return;
    release(event.pointerId);
    touches.delete(event.pointerId);
    resetTouchGesture();
  }
  function suppressGestureClick(event) {
    if (systemClock.now() >= r.suppressClickUntil) return;
    event.preventDefault();
    event.stopPropagation();
  }
  const scope = r.lifecycle.scope;
  scope.listen(viewport, "pointerdown", onTouchDown, { capture: true, passive: false });
  scope.listen(viewport, "pointermove", onTouchMove, { capture: true, passive: false });
  scope.listen(viewport, "pointerup", onTouchEnd, { capture: true, passive: false });
  scope.listen(viewport, "pointercancel", onTouchCancel, { capture: true, passive: false });
  scope.listen(viewport, "click", suppressGestureClick, true);
  scope.addCleanup(resetTouchGesture);
}
