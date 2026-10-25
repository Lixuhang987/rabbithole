import { shouldReduceMotion } from "./core.js";

// The reader is the current card, maximized — but the transition never claims
// the two are the same picture. A geometric morph (scaling the reader down
// onto the card's rect) demands pixel equality between two different
// renderings at the handoff frame, and every miss reads as a jag. So the
// flight makes a smaller, unbreakable claim: the reader is a sheet that lifts
// off from the card's location and settles back toward it — a uniform ~3.5%
// zoom plus fade, anchored at the card's on-screen center (the macOS idiom:
// Dock, Quick Look, Spotlight). One element, one animation, one clock, and
// opacity is exactly 0 at every display flip, so no frame can contain a jump.
//
// The mode classes flip synchronously before a flight starts; the animation is
// purely decorative and interruptible. `mode-flight` on <body> keeps both
// surfaces displayed for the duration, and `.reader-flying` makes the sheet
// inert while it moves.
const ENTER_MS = 200;
const EXIT_MS = 160;
const FLIGHT_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
const LIFT_SCALE = 0.965;
let activeFlight = null;

function endFlight(flight) {
  if (activeFlight !== flight) return;
  activeFlight = null;
  document.body.classList.remove("mode-flight");
  flight.el.classList.remove("reader-flying");
  flight.el.style.transformOrigin = "";
  // Landed: geometry observers can now trust getBoundingClientRect.
  document.dispatchEvent(new CustomEvent("rh-reader-flight-end"));
}

function cancelReaderFlight() {
  const flight = activeFlight;
  if (!flight) return;
  try {
    flight.animation.cancel();
  } catch (e) {
    endFlight(flight);
  }
}

function rectCenter(rect) {
  if (!rect || !rect.width || !rect.height) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function fly(origin, expanding) {
  cancelReaderFlight();
  const el = document.getElementById("reader");
  if (!el) return false;
  if (typeof el.animate !== "function" || shouldReduceMotion() || document.hidden) return false;
  // Anchor the zoom at the card's center so the sheet reads as rising from
  // (or returning into) its card; a missing or off-screen card anchors at the
  // viewport center instead.
  const vw = window.innerWidth || 1,
    vh = window.innerHeight || 1;
  const ox = origin ? Math.max(0, Math.min(origin.x, vw)) : vw / 2;
  const oy = origin ? Math.max(0, Math.min(origin.y, vh)) : vh / 2;
  el.style.transformOrigin = ox + "px " + oy + "px";
  const lifted = { transform: "scale(" + LIFT_SCALE + ")", opacity: 0 };
  const seated = { transform: "none", opacity: 1 };
  document.body.classList.add("mode-flight");
  el.classList.add("reader-flying");
  const animation = el.animate(expanding ? [lifted, seated] : [seated, lifted], {
    duration: expanding ? ENTER_MS : EXIT_MS,
    easing: FLIGHT_EASE,
  });
  const flight = { el: el, animation: animation };
  activeFlight = flight;
  animation.onfinish = function () {
    endFlight(flight);
  };
  animation.oncancel = function () {
    endFlight(flight);
  };
  return true;
}

// Canvas → reader: the sheet rises out of the card it came from.
export function flyReaderFromRect(rect) {
  return fly(rectCenter(rect), true);
}

// Reader → canvas: the sheet settles back toward the card it is.
export function flyReaderToRect(rect) {
  return fly(rectCenter(rect), false);
}
