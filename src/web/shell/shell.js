import { CANVAS_SHELL } from "../../core/html/shell.js";
import { BUTTON_TAG, buttonMarkup, iconButtonMarkup } from "../../core/html/markup.js";
import { BUNNY_MARK_SVG, iconSvg } from "../../core/html/icons.js";
import { wireNotice } from "../../ui/primitives/notice.js";

const TOOLBAR_BUNNY_MARK_SVG = iconSvg("bunny", { size: 16 });

function webToolbarChrome() {
  return `${iconButtonMarkup({ id: "t-rail", title: "Rabbitholes · S", ariaLabel: "Toggle rabbitholes", ariaExpanded: "false", ariaControls: "web-rail", svgIconHtml: iconSvg("rail") })}`
    + `${iconButtonMarkup({ id: "t-new", title: "New Rabbithole · N", ariaLabel: "New Rabbithole", svgIconHtml: iconSvg("new") })}`;
}

export function mountWebShell() {
  document.documentElement.classList.add("web-canvas-active");
  document.body.classList.add("mode-canvas", "web-shell");
  document.body.innerHTML = `<div id="canvas-root">${CANVAS_SHELL}</div>
    <aside id="web-rail" class="web-rail" aria-label="Rabbitholes" tabindex="-1"></aside>
    <div id="composer-modal" class="composer-modal" hidden>
      <div class="composer-card" id="composer-card" tabindex="-1">
        <section id="composer-start" class="composer-start">
          <header class="composer-start-head">
            <span class="composer-title-mark" aria-hidden="true">${BUNNY_MARK_SVG}</span>
            <h1 id="composer-title">Enter a Rabbithole</h1>
          </header>
          <div class="composer-paths" role="group" aria-label="Choose how to begin">
            <${BUTTON_TAG} class="composer-path" id="composer-path-ask" type="button" data-path="ask"><span class="composer-path-icon" aria-hidden="true">${iconSvg("question")}</span><span class="composer-path-copy"><strong>Ask a question</strong><small>Begin with something you want to understand.</small></span><span class="composer-path-arrow" aria-hidden="true">→</span></button>
            <${BUTTON_TAG} class="composer-path" id="composer-path-paste" type="button" data-path="paste"><span class="composer-path-icon" aria-hidden="true">${iconSvg("paste")}</span><span class="composer-path-copy"><strong>Paste text or Markdown</strong><small>Start from your clipboard.</small></span><span class="composer-path-arrow" aria-hidden="true">→</span></button>
            <${BUTTON_TAG} class="composer-path" id="composer-path-url" type="button" data-path="url"><span class="composer-path-icon" aria-hidden="true">${iconSvg("link")}</span><span class="composer-path-copy"><strong>Open a link</strong><small>Start from an article, paper, or webpage.</small></span><span class="composer-path-arrow" aria-hidden="true">→</span></button>
          </div>
        </section>
        <section id="composer-entry" class="composer-entry" hidden>
          <${BUTTON_TAG} id="composer-back" class="composer-back" type="button"><span aria-hidden="true">←</span> All options</button>
          <header class="composer-entry-head"><h2 id="composer-entry-title"></h2><p id="composer-entry-copy"></p></header>
          <textarea id="composer-input" rows="1" autocomplete="off" spellcheck="true"></textarea>
          <div class="composer-entry-actions"><${BUTTON_TAG} id="composer-primary" class="web-primary" type="button"></button></div>
        </section>
        <div id="ingest-status" class="ingest-status" aria-live="polite" aria-atomic="true"></div>
      </div>
    </div>
    <div id="blank-start" class="blank-start" hidden>
      <span id="blank-start-new-wrap" class="blank-start-new-wrap">${buttonMarkup({ bare: true, id: "blank-start-new", className: "blank-start-new", label: "New Rabbithole", kbdHint: "N", svgIconHtml: iconSvg("plus") })}<span id="blank-start-status" class="blank-start-tooltip" role="tooltip">Set up AI before starting a Rabbithole.</span></span>
      ${buttonMarkup({ bare: true, id: "blank-start-setup", className: "blank-start-setup", label: "Set up AI" })}
    </div>
    <nav id="project-menu" class="project-menu popover-surface" role="menu" aria-label="Rabbithole project" hidden>
      <div class="project-menu-head" role="presentation"><span class="project-menu-mark" aria-hidden="true">${BUNNY_MARK_SVG}</span><span><strong>Rabbithole</strong><small>Open source · MIT</small></span></div>
      <a class="project-menu-item" role="menuitem" href="/about/" target="_blank" rel="noopener noreferrer"><span>About Rabbithole</span><span aria-hidden="true">↗</span></a>
      <a class="project-menu-item" role="menuitem" href="/about/#install" target="_blank" rel="noopener noreferrer"><span>Install &amp; self-host</span><span aria-hidden="true">↗</span></a>
      <a class="project-menu-item project-menu-github" role="menuitem" href="https://github.com/shlokkhemani/rabbithole" target="_blank" rel="noopener noreferrer"><span>GitHub</span><span class="project-menu-meta"><span id="project-github-stars" class="github-star-count" aria-label="GitHub stars"><span aria-hidden="true">★</span> Stars</span><span aria-hidden="true">↗</span></span></a>
    </nav>
    <div id="web-toast" class="web-toast"><span data-notice-message></span>${buttonMarkup({ bare: true, label: "Action", hidden: true, dataAttrs: { noticeAction: "" } })}</div>`;
  const notice = wireNotice(document.getElementById("web-toast"), { variant: "toast" });
  document.getElementById("tb-app")?.insertAdjacentHTML("afterbegin",
    `${iconButtonMarkup({ className: "toolbar-brand", id: "t-project", title: "About Rabbithole and project links", ariaLabel: "Rabbithole project menu", ariaHaspopup: "menu", ariaControls: "project-menu", ariaExpanded: "false", svgIconHtml: TOOLBAR_BUNNY_MARK_SVG })}<span class="sep toolbar-brand-sep"></span>${webToolbarChrome()}`);
  return notice;
}
