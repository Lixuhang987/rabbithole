import { isDockedNote, isNoteNode, isReactionNote } from "../../core/hole/ask.js";
import { iconButtonMarkup } from "../../core/html/markup.js";
import { pdfArticleNeedsConversion } from "../../core/pdf-shared.js";
import { changeNodeFontScale, childrenOf, closed, frozen, nodes, resetNodeFontScale, rootId } from "../core.js";
import { closestEl, qs } from "../dom.js";
import { cancelViewAnimation } from "./camera.js";
import { cardButton } from "./card-composer.js";
import { branchAllCollapsed, setBranchCollapsed, setChildrenCollapsed, toggleCollapse } from "./fold.js";
import { convertNoteToAsk, startTitleEditing } from "./note-convert.js";
import { r } from "./runtime.js";
import { canPinWindow, nodePin, pinnedFontScale, setPinnedFontScale, setWindowPinned } from "./shared.js";

// The menu reads and writes whichever presentation the card is in: a pinned
// window owns its own text size, so its % never reflects — or touches — the
// document's authorial font_scale, and unpinning restores the pre-pin size.
function menuFontScale(node) {
  return nodePin(node) ? pinnedFontScale(node) : node.font_scale || 1;
}

export function syncCollapseButton(node, btn) {
  // "card", not "document": expanding a *document* is the reader button's
  // name, and the two actions must never share an accessible name.
  const action = node.collapsed ? "Expand card" : "Collapse card";
  btn.innerHTML = node.collapsed ? r.NODE_RESTORE_ICON : r.NODE_COLLAPSE_ICON;
  btn.setAttribute("aria-label", action);
  btn.title = action + " · Right-click toggles branch";
}

export function nodeMenuButton(node) {
  const button = cardButton(
    iconButtonMarkup({
      bare: true,
      className: "card-btn card-more",
      svgIconHtml: r.NODE_MORE_ICON,
      ariaLabel: "Card menu",
      title: "Card menu",
      ariaHaspopup: "menu",
      ariaControls: "cardmenu",
      ariaExpanded: "false",
    }),
  );
  button.addEventListener("click", function (e) {
    e.stopPropagation();
    openCardMenu(node, button, /** @type {MouseEvent} */ (e).detail === 0);
  });
  node.moreBtn = button;
  return button;
}

export function ensureNodeMenuButton(node) {
  if (!node || node._ephemeral || node.moreBtn || !node.actsEl) return;
  node.actsEl.appendChild(nodeMenuButton(node));
}

export function canConvertNote(node) {
  return (
    !!node &&
    !node._ephemeral &&
    !frozen &&
    !closed &&
    node.id !== rootId &&
    isNoteNode(node) &&
    !isReactionNote(node) &&
    !pdfArticleNeedsConversion(nodes[node.parent_id ?? rootId]) &&
    childrenOf(node.id).length === 0
  );
}

export function openCardMenu(node, trigger, openedByKeyboard) {
  if (!r.cardMenuController || node._ephemeral) return;
  // The menu is anchored to the card's screen rect, and applyTransform
  // dismisses it whenever the view moves — so a reveal glide still in flight
  // would close the menu on its very next frame. Reaching for a card's ⋯ is
  // a gesture like zoom, drag, or pan: the glide yields to it.
  cancelViewAnimation();
  r.cardMenuNode = node;
  document.getElementById("cm-textreset").textContent = Math.round(menuFontScale(node) * 100) + "%";
  // Collapsing is a way of looking, not a change to the hole, so the fold
  // group survives into a frozen snapshot exactly as the header's own
  // collapse button does.
  syncCollapseGroup(node, "cm-");
  document.getElementById("cm-rename").style.display = frozen ? "none" : "";
  document.getElementById("cm-convert").style.display =
    canConvertNote(node) && !!(node.markdown || "").trim() ? "" : "none";
  const pinButton = document.getElementById("cm-pin");
  const showPin = !frozen && canPinWindow(node);
  pinButton.style.display = showPin ? "" : "none";
  qs("#cardmenu .cm-pin-sep").style.display = showPin ? "" : "none";
  pinButton.querySelector(".sm-label").textContent = nodePin(node) ? "Unpin window" : "Pin window";
  const showDelete = !frozen && node.id !== rootId;
  document.getElementById("cm-delete").style.display = showDelete ? "" : "none";
  qs("#cardmenu .cm-delete-sep").style.display = showDelete ? "" : "none";
  r.cardMenuController.toggle(trigger, { focusFirst: openedByKeyboard });
}

export function onCardMenuClick(e) {
  const button = closestEl(e.target, "button");
  const node = r.cardMenuNode;
  if (!button || !node) return;
  if (button.id === "cm-textdown" || button.id === "cm-textup" || button.id === "cm-textreset") {
    const delta = button.id === "cm-textup" ? 0.1 : -0.1;
    const scale = nodePin(node)
      ? setPinnedFontScale(node, button.id === "cm-textreset" ? 1 : pinnedFontScale(node) + delta)
      : button.id === "cm-textreset"
        ? resetNodeFontScale(node)
        : changeNodeFontScale(node, delta);
    document.getElementById("cm-textreset").textContent = Math.round(scale * 100) + "%";
    return;
  }
  r.cardMenuController.close();
  if (button.id === "cm-copy") r.lifecycle.hooks.copyNodeMarkdown(node);
  else if (button.id === "cm-rename") startTitleEditing(node, node.titleEl);
  else if (button.id === "cm-convert") convertNoteToAsk(node, node.markdown);
  else if (button.id === "cm-pin") setWindowPinned(node, !nodePin(node));
  else if (button.id.indexOf("cm-collapse") === 0) runCollapseAction(node, button.id.slice(3));
  else if (button.id === "cm-delete") r.lifecycle.hooks.removeBranch(node);
}

// The subtree's own fold state, read off the direct children only: once every
// one of them is folded the children row flips to "expand", and nothing deeper
// gets a vote (a half-open grandchild must not keep the label saying
// "collapse" when the row under the card is already shut).
export function childrenAllCollapsed(node) {
  const kids = placedChildren(node.id);
  return (
    kids.length > 0 &&
    kids.every(function (kid) {
      return !!kid.collapsed;
    })
  );
}

// Docked notes are drawn on their parent, not beside it: they have no card to
// fold, no place to tidy into, and no bounds to frame.
export function placedChildren(id) {
  return childrenOf(id).filter(function (kid) {
    return !isDockedNote(kid);
  });
}

// Three scopes, three rows, each flipping on exactly the thing its own noun
// names: the card, the card plus its subtree, the subtree alone. A card with
// nothing under it keeps only the row about itself.
export function syncCollapseGroup(node, prefix) {
  const hasChildren = placedChildren(node.id).length > 0;
  syncCollapseRow(document.getElementById(prefix + "collapse"), !!node.collapsed, "", true);
  syncCollapseRow(
    document.getElementById(prefix + "collapse-branch"),
    branchAllCollapsed(node),
    " branch",
    hasChildren,
  );
  syncCollapseRow(
    document.getElementById(prefix + "collapse-children"),
    childrenAllCollapsed(node),
    " children",
    hasChildren,
  );
}

// Only the verb flips. The row's glyph names its scope, which the card's state
// never changes, so the shell's per-row mini-tree has to survive every open.
export function syncCollapseRow(item, expands, noun, shown) {
  item.style.display = shown ? "" : "none";
  item.querySelector(".sm-label").textContent = (expands ? "Expand" : "Collapse") + noun;
}

// Each row does what its label just said, so the action reads the same state
// the label was rendered from.
export function runCollapseAction(node, action) {
  if (action === "collapse") toggleCollapse(node);
  else if (action === "collapse-branch") setBranchCollapsed(node, !branchAllCollapsed(node));
  else if (action === "collapse-children") setChildrenCollapsed(node, !childrenAllCollapsed(node));
}
