import { DEFAULT_ASK_PRESET_KEYS, DEFAULT_ASK_PRESETS } from "../core/hole/lens.js";
import { DEFAULT_REACTION_PROMPTS, REACTION_KEYS } from "../core/hole/reaction.js";
import { buttonMarkup } from "../core/html/markup.js";
import { escapeHtml } from "../core/utils.js";
import { createCleanupScope } from "./kit/scope.js";
import { registerLayer } from "./overlay/layer-stack.js";
import {
  askPreset,
  askPresets,
  askPresetsLinked,
  createCustomAskPreset,
  reactionPrompt,
  reactionPrompts,
  resetAskPreset,
  resetReactionPrompt,
  setAskPreset,
  setAskPresetRemoved,
  setAskPresetsLinked,
  setReactionPrompt,
  visibleAskPresetKeys,
} from "./preferences.js";

// One text node keeps mirrorLabel's live preview a single nodeValue write.
function presetPillText(preset) {
  return `${preset.label} `;
}

/** Fill one composer action group from the user's local preset set. */
export function renderAskPresetActions(actions, set) {
  if (!actions) return;
  const setKey = set === "selection" ? "selection" : "followup";
  const group = actions.querySelector(".preset-actions");
  if (!group) return;
  const disabled = !!group.querySelector(".lens:disabled");
  group.dataset.presetSet = setKey;
  const keys = visibleAskPresetKeys(setKey);
  // With every preset removed the surface rests as a bare input; CSS hides the
  // empty row until a draft brings the commit pair back.
  actions.classList.toggle("no-presets", keys.length === 0);
  actions.classList.toggle("has-four-presets", keys.length === 4);
  group.innerHTML = keys
    .map((key, index) => {
      const preset = askPreset(setKey, key) || DEFAULT_ASK_PRESETS[setKey][key];
      return buttonMarkup({
        bare: true,
        className: "lens ask-preset",
        dataAttrs: { lens: key },
        label: presetPillText(preset),
        title: preset.instruction,
        kbdHint: String(index + 1),
        disabled,
      });
    })
    .join("");
}

export function refreshAskPresetActions(root = document) {
  root.querySelectorAll(".preset-actions[data-preset-set]").forEach((group) => {
    const element = /** @type {HTMLElement} */ (group);
    renderAskPresetActions(element.closest(".ask-actions"), element.dataset.presetSet);
  });
}

export function presetFor(set, key) {
  return askPreset(set, key);
}

export function presetLabelForOrigin(origin) {
  if (!origin?.lens) return "";
  const set = origin.branch_type === "selection" ? "selection" : "followup";
  return askPreset(set, origin.lens)?.label || String(origin.lens);
}

export function displayQuestionForOrigin(origin) {
  return (
    [origin?.instruction, origin?.question || origin?.web_root_question]
      .map((text) => String(text || "").trim())
      .filter(Boolean)
      .join("\n\n") || presetLabelForOrigin(origin)
  );
}

/*
 * The Quick questions section is the product wearing its own clothes: each
 * preset set renders inside a faithful, full-width replica of its real surface
 * — the selection popover's glass and shadow, the reader composer's card —
 * built from the real .ask-input/.ask-actions parts so spacing and washes can
 * never drift from the product. Clicking a pill expands its editor in place
 * beneath the row. One editor is open at a time; the open editor joins the
 * overlay stack so Escape gives back one level (editor, then sheet) and a
 * click elsewhere collapses it without swallowing that click. Ticking the
 * link collapses the follow-up surface entirely — its own set is kept, not
 * overwritten, so unticking restores it exactly.
 */

const SURFACE_COPY = Object.freeze({
  selection: {
    title: "When you select something",
    group: "Selection presets",
  },
  followup: {
    title: "When you follow up",
    group: "Follow-up presets",
  },
});

function samePreset(a, b) {
  return a?.label === b?.label && a?.instruction === b?.instruction;
}

function mockPresetButton(set, key, index) {
  const preset = askPreset(set, key);
  return buttonMarkup({
    bare: true,
    className: "lens",
    dataAttrs: { presetButton: key },
    label: presetPillText(preset),
    title: preset.instruction,
    kbdHint: String(index + 1),
    ariaExpanded: "false",
  });
}

function surfaceMarkup(set) {
  const copy = SURFACE_COPY[set];
  return `<section class="asking-surface" data-asking-surface data-set="${set}">
    <header><h4>${copy.title}</h4></header>
    <div class="asking-mock ${set === "selection" ? "asking-mock-popover" : "asking-mock-composer"}">
      <div class="ask-input"><div class="asking-ghost" aria-hidden="true">Ask or note…</div></div>
      <div class="ask-actions" role="group" aria-label="${copy.group}"><div class="preset-actions" data-asking-actions></div></div>
      <div class="asking-editor" data-asking-editor><div class="asking-editor-body" data-asking-editor-body></div></div>
    </div>
    <p class="asking-removed" data-asking-removed hidden></p>
  </section>`;
}

function editorMarkup(set, key) {
  const preset = askPreset(set, key);
  const defaults = DEFAULT_ASK_PRESETS[set][key];
  const prefix = `asking-${set}-${key}`;
  return `<div class="asking-editor-fields">
    <label for="${prefix}-label">Label</label>
    <input id="${prefix}-label" name="${prefix}-label" type="text" autocomplete="off" spellcheck="false" data-preset-label maxlength="80" value="${escapeHtml(preset.label)}">
    <label for="${prefix}-instruction">Instruction</label>
    <textarea id="${prefix}-instruction" name="${prefix}-instruction" autocomplete="off" data-preset-instruction rows="2" maxlength="4000">${escapeHtml(preset.instruction)}</textarea>
    <div class="asking-editor-foot">
      ${buttonMarkup({
        bare: true,
        className: "asking-preset-remove",
        dataAttrs: { presetRemove: true },
        label: "Remove",
        title:
          key === "custom"
            ? `Remove “${preset.label}”`
            : `Take “${preset.label}” off this row — bring it back any time`,
      })}
      ${
        defaults
          ? buttonMarkup({
              bare: true,
              className: "asking-preset-reset",
              dataAttrs: { presetReset: true },
              label: "Reset to default",
              title: `Back to the built-in “${defaults.label}” question`,
              hidden: samePreset(preset, defaults),
            })
          : ""
      }
      ${buttonMarkup({
        bare: true,
        className: "asking-preset-done",
        dataAttrs: { presetDone: true },
        label: "Done",
        title: "Close the editor — changes save as you type",
      })}
    </div>
  </div>`;
}

const REACTION_COPY = Object.freeze({ up: "Thumbs up", down: "Thumbs down" });

function reactionSettingsMarkup() {
  return `<section class="asking-reactions" data-asking-reactions>
    <header><h4>Reactions</h4></header>
    <div class="asking-reaction-list">
      ${REACTION_KEYS.map((key) => {
        const prompt = reactionPrompt(key);
        const prefix = `asking-reaction-${key}`;
        return `<div class="settings-sheet-row asking-reaction-row" data-reaction-prompt="${key}">
          <span class="asking-reaction-glyph" aria-hidden="true">${DEFAULT_REACTION_PROMPTS[key].glyph}</span>
          <div class="asking-editor-fields asking-reaction-fields">
            <label for="${prefix}-instruction">Instruction</label>
            <textarea id="${prefix}-instruction" name="${prefix}-instruction" autocomplete="off" data-reaction-instruction rows="2" maxlength="4000" aria-label="Instruction for ${REACTION_COPY[key].toLowerCase()}">${escapeHtml(prompt.instruction)}</textarea>
            <div class="asking-editor-foot">
              ${buttonMarkup({
                bare: true,
                className: "asking-preset-reset",
                dataAttrs: { reactionReset: true },
                label: "Reset to default",
                title: `Restore the default ${REACTION_COPY[key].toLowerCase()} instruction`,
                hidden: prompt.instruction === DEFAULT_REACTION_PROMPTS[key].instruction,
              })}
            </div>
          </div>
        </div>`;
      }).join("")}
    </div>
  </section>`;
}

function askingMarkup() {
  return `<div class="settings-sheet-section asking-settings">
    ${surfaceMarkup("selection")}
    <label class="settings-sheet-row asking-link">
      <span class="settings-sheet-copy">
        <span class="settings-sheet-label">Follow-ups ask the same questions</span>
        <span class="settings-sheet-sub">One set everywhere. Turn off to give follow-ups their own.</span>
      </span>
      <span class="switch">
        <input type="checkbox" role="switch" data-asking-link>
        <span class="switch-track"></span>
      </span>
    </label>
    <div class="asking-reveal" data-asking-reveal>
      <div class="asking-reveal-body">
        ${surfaceMarkup("followup")}
      </div>
    </div>
    ${reactionSettingsMarkup()}
  </div>`;
}

export function mountAskingSettings(host) {
  host.innerHTML = askingMarkup();
  const scope = createCleanupScope();
  const link = /** @type {HTMLInputElement} */ (host.querySelector("[data-asking-link]"));
  const reveal = /** @type {HTMLElement} */ (host.querySelector("[data-asking-reveal]"));
  const surfaces = {};
  host.querySelectorAll("[data-asking-surface]").forEach((root) => {
    surfaces[root.dataset.set] = {
      set: root.dataset.set,
      row: root.querySelector(".ask-actions"),
      group: root.querySelector("[data-asking-actions]"),
      editor: root.querySelector("[data-asking-editor]"),
      body: root.querySelector("[data-asking-editor-body]"),
      removed: root.querySelector("[data-asking-removed]"),
    };
  });

  /** @type {{ set: string, key: string, unregister: (settings?: any) => void } | null} */
  let active = null;

  const buttonOf = (set, key) => surfaces[set].group.querySelector(`[data-preset-button="${key}"]`);

  function renderActions(set) {
    const surface = surfaces[set];
    const keys = visibleAskPresetKeys(set);
    surface.row.classList.remove("no-presets");
    surface.row.classList.toggle("has-four-presets", keys.length === 4);
    surface.group.innerHTML =
      keys.map((key, index) => mockPresetButton(set, key, index)).join("") +
      (askPreset(set, "custom")
        ? ""
        : buttonMarkup({
            bare: true,
            className: "lens asking-add",
            dataAttrs: { presetAdd: true },
            label: "Add question",
            title: "Add a fourth quick question",
          }));
  }

  function renderRemoved(set) {
    const surface = surfaces[set];
    const removed = DEFAULT_ASK_PRESET_KEYS.filter((key) => askPreset(set, key)?.removed === true);
    surface.removed.hidden = removed.length === 0;
    surface.removed.innerHTML = removed.length
      ? `<span class="asking-removed-label">Removed:</span>` +
        removed
          .map((key) =>
            buttonMarkup({
              bare: true,
              className: "asking-restore",
              dataAttrs: { presetRestore: key },
              label: askPreset(set, key).label,
              title: `Bring “${askPreset(set, key).label}” back`,
            }),
          )
          .join("")
      : "";
  }

  function closeEditor(options) {
    if (!active) return;
    const { set, key, unregister } = active;
    active = null;
    unregister({ restoreFocus: false });
    const surface = surfaces[set];
    surface.editor.classList.remove("open");
    const button = buttonOf(set, key);
    if (button) {
      button.classList.remove("editing");
      button.setAttribute("aria-expanded", "false");
      if (options?.focusButton) button.focus();
    }
  }

  function syncReset() {
    if (!active) return;
    const reset = surfaces[active.set].body.querySelector("[data-preset-reset]");
    const defaults = DEFAULT_ASK_PRESETS[active.set][active.key];
    if (reset && defaults) reset.hidden = samePreset(askPreset(active.set, active.key), defaults);
  }

  // The pill is the preview: its label and tooltip track the stored value live.
  function mirrorLabel(set, key) {
    const saved = askPreset(set, key);
    const button = buttonOf(set, key);
    if (!button) return;
    if (button.firstChild) button.firstChild.nodeValue = presetPillText(saved);
    button.title = saved.instruction;
  }

  function openEditor(set, key) {
    closeEditor();
    const surface = surfaces[set];
    surface.body.innerHTML = editorMarkup(set, key);
    const button = buttonOf(set, key);
    const unregister = registerLayer({
      element: surface.editor,
      trigger: button,
      preventOutsidePointerDefault: false,
      restoreFocus: false,
      onClose: (reason) => closeEditor({ focusButton: reason === "escape" }),
    });
    active = { set, key, unregister };
    surface.editor.classList.add("open");
    button.classList.add("editing");
    button.setAttribute("aria-expanded", "true");
    surface.body.querySelector("[data-preset-label]")?.focus();
  }

  Object.values(surfaces).forEach((surface) => {
    scope.listen(surface.group, "click", (event) => {
      const button = /** @type {HTMLButtonElement | null} */ (
        /** @type {Element} */ (event.target).closest?.("[data-preset-button], [data-preset-add]")
      );
      if (!button) return;
      if (button.hasAttribute("data-preset-add")) {
        createCustomAskPreset(surface.set);
        renderActions(surface.set);
        renderRemoved(surface.set);
        openEditor(surface.set, "custom");
        const label = /** @type {HTMLInputElement | null} */ (surface.body.querySelector("[data-preset-label]"));
        label?.select();
        return;
      }
      const key = button.dataset.presetButton;
      if (active && active.set === surface.set && active.key === key) closeEditor({ focusButton: true });
      else openEditor(surface.set, key);
    });
    scope.listen(surface.body, "input", (event) => {
      if (!active || active.set !== surface.set) return;
      const field = /** @type {Element} */ (event.target);
      if (!field.matches?.("[data-preset-label], [data-preset-instruction]")) return;
      const label = surface.body.querySelector("[data-preset-label]");
      const instruction = surface.body.querySelector("[data-preset-instruction]");
      setAskPreset(active.set, active.key, { label: label.value, instruction: instruction.value });
      mirrorLabel(active.set, active.key);
      syncReset();
    });
    scope.listen(surface.body, "focusout", (event) => {
      if (!active || active.set !== surface.set) return;
      const field = /** @type {HTMLInputElement} */ (event.target);
      if (!field.matches?.("[data-preset-label], [data-preset-instruction]")) return;
      const saved = askPreset(active.set, active.key);
      field.value = field.matches("[data-preset-label]") ? saved.label : saved.instruction;
    });
    scope.listen(surface.body, "keydown", (event) => {
      if (!active || active.set !== surface.set) return;
      const keyEvent = /** @type {KeyboardEvent} */ (event);
      if (keyEvent.key !== "Enter") return;
      if (!(/** @type {Element} */ (event.target).matches?.("[data-preset-label]"))) return;
      keyEvent.preventDefault();
      closeEditor({ focusButton: true });
    });
    scope.listen(surface.body, "click", (event) => {
      if (!active || active.set !== surface.set) return;
      const target = /** @type {Element} */ (event.target);
      if (target.closest?.("[data-preset-done]")) {
        closeEditor({ focusButton: true });
        return;
      }
      if (target.closest?.("[data-preset-reset]")) {
        const next = resetAskPreset(active.set, active.key);
        surface.body.querySelector("[data-preset-label]").value = next.label;
        surface.body.querySelector("[data-preset-instruction]").value = next.instruction;
        mirrorLabel(active.set, active.key);
        syncReset();
        return;
      }
      if (target.closest?.("[data-preset-remove]")) {
        const key = active.key;
        closeEditor();
        setAskPresetRemoved(surface.set, key, true);
        renderActions(surface.set);
        renderRemoved(surface.set);
        // Continuity for keyboard users: focus lands on the way back in.
        if (key === "custom") surface.group.querySelector("[data-preset-add]")?.focus();
        else surface.removed.querySelector(`[data-preset-restore="${key}"]`)?.focus();
      }
    });
    scope.listen(surface.removed, "click", (event) => {
      const chip = /** @type {HTMLElement | null} */ (
        /** @type {Element} */ (event.target).closest?.("[data-preset-restore]")
      );
      if (!chip) return;
      const key = chip.dataset.presetRestore;
      setAskPresetRemoved(surface.set, key, false);
      renderActions(surface.set);
      renderRemoved(surface.set);
      buttonOf(surface.set, key)?.focus();
    });
  });

  link.checked = askPresetsLinked();
  reveal.classList.toggle("collapsed", link.checked);
  scope.listen(link, "change", () => {
    if (active && active.set === "followup") closeEditor();
    setAskPresetsLinked(link.checked);
    reveal.classList.toggle("collapsed", link.checked);
    if (!link.checked) {
      // The follow-up set was kept, not overwritten — re-render its own truth.
      renderActions("followup");
      renderRemoved("followup");
    }
  });

  renderActions("selection");
  renderRemoved("selection");
  renderActions("followup");
  renderRemoved("followup");

  host.querySelectorAll("[data-reaction-prompt]").forEach((row) => {
    const key = row.dataset.reactionPrompt;
    const field = /** @type {HTMLTextAreaElement} */ (row.querySelector("[data-reaction-instruction]"));
    const reset = /** @type {HTMLButtonElement} */ (row.querySelector("[data-reaction-reset]"));
    const syncReset = () => {
      reset.hidden = reactionPrompt(key).instruction === DEFAULT_REACTION_PROMPTS[key].instruction;
    };
    scope.listen(field, "input", () => {
      setReactionPrompt(key, { instruction: field.value });
      syncReset();
    });
    scope.listen(field, "focusout", () => {
      field.value = reactionPrompt(key).instruction;
    });
    scope.listen(reset, "click", () => {
      field.value = resetReactionPrompt(key).instruction;
      syncReset();
      field.focus();
    });
  });

  return () => {
    closeEditor();
    scope.dispose();
  };
}

export function askingSettingsSection() {
  // Touch storage at the section boundary so legacy shapes migrate before UI.
  askPresets();
  reactionPrompts();
  return { id: "asking", label: "Quick questions", order: 5, mount: mountAskingSettings };
}
