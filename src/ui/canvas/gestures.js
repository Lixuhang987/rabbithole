import { isNoteNode } from "../../core/hole/ask.js";
import { DEFAULT_STANDALONE_NOTE } from "../../core/layout.js";
import { rootId, setViewAdjusted, view } from "../core.js";
import { createEdgeScroller } from "../edge-scroll.js";
import { applyTransform, cancelViewAnimation, screenToWorld, visibleCanvasRect } from "./camera.js";
import { drawEdges, scheduleNodeEdges } from "./edges.js";
import { translateStoredStackPositions, windowBranch } from "./fold.js";
import { r } from "./runtime.js";
import { canvasCard, nodePin, syncNodePinPresentation } from "./shared.js";

export function layoutNode(node) {
  const el = canvasCard(node);
  el.style.left = node.position.x + "px";
  el.style.top = node.position.y + "px";
  el.style.width = node.size.w + "px";
  if (!node.collapsed) {
    // Branch cards use their saved/default height as a ceiling, not a floor.
    // Short answers therefore hug their content while longer answers retain
    // the existing scrollable viewport. Keep the root's established fixed
    // document window; it is the canvas anchor rather than a branch.
    if (node._ephemeral && isNoteNode(node) && node.parent_id == null) {
      el.style.height = "auto";
      el.style.minHeight = DEFAULT_STANDALONE_NOTE.h + "px";
      el.style.maxHeight = node.size.h + "px";
    } else if (node.id === rootId || (isNoteNode(node) && node.parent_id == null)) {
      el.style.height = node.size.h + "px";
      el.style.minHeight = "";
      el.style.maxHeight = "";
    } else {
      el.style.height = "auto";
      el.style.minHeight = "";
      el.style.maxHeight = node.size.h + "px";
    }
  }
  syncNodePinPresentation(node);
}

// Shared pointer-gesture wiring: cleans up on pointerup AND pointercancel/
// lostpointercapture, so an interrupted gesture (touch cancel, window blur)
// never leaves move listeners or drag state stuck.
export function onPointerGesture(handle, onDown, onMove, onUp, scope) {
  function pointerDown(e) {
    if (!onDown(e)) return;
    try {
      handle.setPointerCapture(e.pointerId);
    } catch (_e) {}
    function move(ev) {
      if (ev.pointerId === e.pointerId) onMove(ev);
    }
    function finish(commit) {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", done);
      handle.removeEventListener("pointercancel", done);
      handle.removeEventListener("lostpointercapture", done);
      r.activePointerGestures.delete(cancel);
      try {
        handle.releasePointerCapture(e.pointerId);
      } catch (_e) {}
      // onUp runs on every ending, interrupted or not, and is told which it
      // was. A gesture torn down by a pinch takeover has still left the world
      // changed, and whatever it started — a running edge scroll, a grabbing
      // cursor — has to be shut down on that path too, not only on a clean up.
      onUp(commit);
    }
    function done(ev) {
      if (ev.pointerId === e.pointerId) finish(true);
    }
    function cancel() {
      finish(false);
    }
    r.activePointerGestures.add(cancel);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", done);
    handle.addEventListener("pointercancel", done);
    handle.addEventListener("lostpointercapture", done);
  }
  if (scope) scope.listen(handle, "pointerdown", pointerDown);
  else handle.addEventListener("pointerdown", pointerDown);
}

// The head carries the card's own gestures — drag it, double-click to open — but it also
// holds the controls, and a pointer that lands on one of those is operating the control,
// not the card. Every head gesture owes that distinction the same answer.
export function onCardControl(e) {
  return !!e.target.closest(".card-btn, [contenteditable]");
}

// A card gesture that can outrun the viewport. Two rules make that work:
//
// The grab is anchored in world coordinates, not as a running screen delta,
// so the card is re-derived from wherever the pointer currently points into
// the world. That is what lets the camera move mid-gesture at all — a screen
// delta would slide the card out from under the cursor by exactly the pan.
//
// And every camera step re-runs that derivation from the *unchanged* pointer,
// so while the canvas scrolls the card keeps travelling with the cursor.
export function enableCardGesture(node, handle, opts) {
  let grabX,
    grabY,
    lastX,
    lastY,
    scroller = null,
    affected = [node];
  function place() {
    const w = screenToWorld(lastX, lastY);
    affected = opts.apply(node, w.x - grabX, w.y - grabY) || [node];
    for (let i = 0; i < affected.length; i++) {
      layoutNode(affected[i]);
      scheduleNodeEdges(affected[i]);
    }
  }
  onPointerGesture(
    handle,
    function (e) {
      if (e.button !== 0 || !opts.accept(e)) return false;
      e.preventDefault();
      if (opts.stopPropagation) e.stopPropagation();
      r.lifecycle.hooks.hideAsk();
      const w = screenToWorld(e.clientX, e.clientY);
      const anchor = opts.anchor(node);
      grabX = w.x - anchor.x;
      grabY = w.y - anchor.y;
      lastX = e.clientX;
      lastY = e.clientY;
      r.activeCardGestures.add(place);
      scroller = createEdgeScroller(visibleCanvasRect, function (dx, dy) {
        cancelViewAnimation(); // an in-flight glide would fight the drag
        setViewAdjusted(true);
        view.x += dx;
        view.y += dy;
        applyTransform();
      });
      return true;
    },
    function (ev) {
      lastX = ev.clientX;
      lastY = ev.clientY;
      place();
      if (scroller) scroller.update(lastX, lastY);
    },
    function () {
      r.activeCardGestures.delete(place);
      r.wheelKind = null;
      r.wheelCard = null;
      if (scroller) scroller.stop();
      scroller = null;
      drawEdges();
      if (opts.commit) opts.commit(affected);
      else r.lifecycle.hooks.persistNode(node);
    },
  );
}

export function enableDrag(node, handle) {
  let moveBranch = false;
  let targets = [node];
  let origins = [];
  let primaryOrigin = { x: node.position.x, y: node.position.y };
  enableCardGesture(node, handle, {
    accept: function (e) {
      moveBranch = e.shiftKey;
      return !nodePin(node) && !onCardControl(e);
    },
    anchor: function (n) {
      targets = moveBranch ? windowBranch(n) : [n];
      origins = targets.map(function (current) {
        return { node: current, x: current.position.x, y: current.position.y };
      });
      primaryOrigin = { x: n.position.x, y: n.position.y };
      return primaryOrigin;
    },
    apply: function (_n, x, y) {
      const dx = x - primaryOrigin.x,
        dy = y - primaryOrigin.y;
      for (let i = 0; i < origins.length; i++) {
        origins[i].node.position.x = origins[i].x + dx;
        origins[i].node.position.y = origins[i].y + dy;
      }
      return targets;
    },
    commit: function (moved) {
      translateStoredStackPositions(origins);
      if (moved.length > 1) r.lifecycle.hooks.persistNodesBulk(moved);
      else r.lifecycle.hooks.persistNode(node);
    },
  });
}

export function enableResize(node, handle) {
  enableCardGesture(node, handle, {
    stopPropagation: true,
    accept: function () {
      return !nodePin(node);
    },
    anchor: function (n) {
      return { x: n.position.x + n.size.w, y: n.position.y + n.size.h };
    },
    apply: function (n, x, y) {
      n.size.w = Math.max(240, x - n.position.x);
      n.size.h = Math.max(160, y - n.position.y);
    },
  });
}
