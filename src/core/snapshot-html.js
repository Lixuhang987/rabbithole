import { CANVAS_SHELL } from "./html/shell.js";
import { markdownContainsBlockType } from "./blocks.js";
import { escapeHtml, serializeForInlineScript } from "./utils.js";
import { assembleRabbitholePage } from "./html/document.js";

/** @param {any} projection */
export function snapshotProjectionUsesMermaid(projection) {
  return !!projection?.hole?.nodes?.some((/** @type {any} */ node) => markdownContainsBlockType(node?.markdown, "mermaid"));
}

/** @param {any} projection */
export function snapshotProjectionUsesPdf(projection) {
  const nodes = projection?.hole?.nodes || [];
  const regions = new Set(nodes.map((/** @type {any} */ node) => node.origin?.anchor?.pdf)
    .filter((/** @type {any} */ anchor) => anchor?.kind === "region")
    .map((/** @type {any} */ anchor) => anchor.source_sha256));
  return nodes.some((/** @type {any} */ node) => node?.extensions?.pdf?.version === 2 &&
    (!node.extensions.pdf.converted || regions.has(node.extensions.pdf.source?.sha256)));
}

/** @param {unknown} source */
function mermaidRuntimeCarrier(source) {
  const escaped = String(source || "").replace(/<\/script/gi, "<\\/script");
  return `<script type="application/vnd.rabbithole+mermaid" id="rabbithole-mermaid-runtime">${escaped}</script>`;
}

/**
 * @param {{
 *   title: string,
 *   stylesheetText: string,
 *   dompurifySource: string,
 *   mermaidSource?: string,
 *   frozenClientSource: string,
 *   pdfWorkerSource?: string,
 *   pdfJsSource?: string,
 *   snapshotProjection: any
 * }} options
 */
export function buildSnapshotHtml({ title, stylesheetText, dompurifySource, mermaidSource = "", pdfJsSource = "", pdfWorkerSource = "", frozenClientSource, snapshotProjection }) {
  const usesMermaid = snapshotProjectionUsesMermaid(snapshotProjection);
  const usesPdf = snapshotProjectionUsesPdf(snapshotProjection);
  if (usesMermaid && !mermaidSource) throw new Error("Mermaid runtime is unavailable for this snapshot");
  if (usesPdf && (!pdfWorkerSource || !pdfJsSource)) throw new Error("PDF runtime is unavailable for this snapshot");
  var lt = String.fromCharCode(60);
  var gt = String.fromCharCode(62);
  var scriptOpen = lt + "script" + gt;
  var scriptClose = lt + String.fromCharCode(47) + "script" + gt;
  var payloadOpen = lt + 'script type="application/vnd.rabbithole+json" id="rabbithole-portable"' + gt;
  const bodyHtml = CANVAS_SHELL +
    (usesMermaid ? "\n" + mermaidRuntimeCarrier(mermaidSource) : "") +
    (usesPdf ? "\n" + pdfJsRuntimeCarrier(pdfJsSource) + "\n" + pdfWorkerRuntimeCarrier(pdfWorkerSource) : "") +
    "\n" + payloadOpen + serializeForInlineScript(snapshotProjection) + scriptClose +
    "\n" + scriptOpen + "\n" +
    dompurifySource +
    "\n(function(){\n" +
    '  "use strict";\n' +
    frozenClientSource +
    "\n  var payload = document.getElementById(\"rabbithole-portable\");\n" +
    "  RabbitholeFrozenClient.startPortableSnapshot(JSON.parse(payload.textContent));\n" +
    "})();\n" +
    scriptClose;
  return assembleRabbitholePage({ mode: "frozen", title, stylesheetText, bodyHtml });
}

/** @param {unknown} source */
function pdfJsRuntimeCarrier(source) {
  const escaped = String(source || "").replace(/<\/script/gi, "<\\/script");
  return `<script type="application/vnd.rabbithole+pdfjs" id="rabbithole-pdfjs-runtime">${escaped}</script>`;
}

/** @param {unknown} source */
function pdfWorkerRuntimeCarrier(source) {
  const escaped = String(source || "").replace(/<\/script/gi, "<\\/script");
  return `<script type="application/vnd.rabbithole+pdf-worker" id="rabbithole-pdf-worker-runtime">${escaped}</script>`;
}
