import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { serializeForInlineScript } from "../../core/utils.js";
import { createSourceReader, devEnabled } from "./source-reader.js";

const CLIENT_PATH = new URL("../../../dist/client.js", import.meta.url);
const FROZEN_CLIENT_PATH = new URL("../../../dist/frozen-client.js", import.meta.url);
const KATEX_CSS_PATH = new URL("../../../dist/katex.css", import.meta.url);
const CANVAS_CSS_PATH = new URL("../../../dist/canvas.css", import.meta.url);
const require = createRequire(import.meta.url);
const DOMPURIFY_SCRIPT_PATH = require.resolve("dompurify/dist/purify.min.js");
const MERMAID_SCRIPT_PATH = require.resolve("@mermaid-js/tiny/dist/mermaid.tiny.js");
const PDF_PACKAGE_ROOT = path.dirname(require.resolve("pdfjs-dist/package.json"));
const PDF_WORKER_PATH = path.join(PDF_PACKAGE_ROOT, "build/pdf.worker.min.mjs");
const PDFJS_PATH = path.join(PDF_PACKAGE_ROOT, "build/pdf.min.mjs");

// Shipped installs read the bundles once at import and freeze them. Under
// RABBITHOLE_DEV the frozen object is skipped and every access re-reads changed
// files, so a browser reload picks up a rebuild without restarting the server.
const UI_ASSETS = devEnabled() ? null : Object.freeze({
  stylesheetText: `${fs.readFileSync(CANVAS_CSS_PATH, "utf8")}\n${fs.readFileSync(KATEX_CSS_PATH, "utf8")}`,
  clientSource: fs.readFileSync(CLIENT_PATH, "utf8"),
  frozenClientSource: fs.readFileSync(FROZEN_CLIENT_PATH, "utf8"),
});

const readKatexCss = createSourceReader(KATEX_CSS_PATH);
const readCanvasCss = createSourceReader(CANVAS_CSS_PATH);
const readClient = createSourceReader(CLIENT_PATH);
const readFrozenClient = createSourceReader(FROZEN_CLIENT_PATH);

export async function getUiAssets() {
  if (UI_ASSETS) return UI_ASSETS;
  return {
    stylesheetText: `${readCanvasCss()}\n${readKatexCss()}`,
    clientSource: readClient(),
    frozenClientSource: readFrozenClient(),
  };
}

export const getDompurifyScript = memoizedTransform(createSourceReader(DOMPURIFY_SCRIPT_PATH), escapeScriptClose);
export const getMermaidScript = memoizedTransform(createSourceReader(MERMAID_SCRIPT_PATH), escapeScriptClose);
export const getPdfWorkerScript = createSourceReader(PDF_WORKER_PATH);
export const getPdfJsScript = createSourceReader(PDFJS_PATH);
export const getFrozenClientLiteral = memoizedTransform(readFrozenClientSource, serializeForInlineScript);
export const getInlinePdfWorkerScript = memoizedTransform(getPdfWorkerScript, escapeScriptClose);
export const getInlinePdfJsScript = memoizedTransform(getPdfJsScript, escapeScriptClose);

function readFrozenClientSource() {
  return UI_ASSETS ? UI_ASSETS.frozenClientSource : readFrozenClient();
}

function escapeScriptClose(source) {
  return source.replace(/<\/script/gi, "<\\/script");
}

function memoizedTransform(read, transform) {
  let previousSource = null;
  let transformed = null;
  return function readTransformed() {
    const source = read();
    if (source !== previousSource) {
      previousSource = source;
      transformed = transform(source);
    }
    return transformed;
  };
}
