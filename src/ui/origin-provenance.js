import { renderPdfRegion } from "../core/pdf/crop.js";
import { normalizePdfExtension } from "../core/pdf-shared.js";
import { displayQuestionForOrigin } from "./ask-presets.js";
import { nodes } from "./core.js";
import { openImageLightbox } from "./image-ux.js";
import { appendOriginAttachmentThumbnails, originAttachmentNames } from "./origin-attachments.js";
import { acquirePdfDocument } from "./pdf-runtime.js";
import { resolveAssetUrl } from "./renderer.js";

const regionPreviews = new WeakMap();

/** Build a PDF clip from its stored image or source PDF coordinates. */
export function buildOriginCrop(node, surface) {
  const name = node?.origin?.crop_asset;
  const anchor = node?.origin?.anchor?.pdf;
  const pdf =
    !name && anchor?.kind === "region"
      ? Object.values(nodes)
          .map(normalizePdfExtension)
          .find((source) => source?.source.sha256 === anchor.source_sha256)
      : null;
  if (!name && !pdf) return null;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `rh-origin-crop rh-origin-crop-${surface || "card"}`;
  button.setAttribute("aria-label", "Open selected PDF region");
  button.title = "Open selected PDF region";
  const img = document.createElement("img");
  if (name) img.src = resolveAssetUrl(name);
  else {
    let preview = regionPreviews.get(node);
    if (!preview) {
      preview = renderOriginRegion(pdf, anchor);
      regionPreviews.set(node, preview);
    }
    preview
      .then((url) => {
        img.src = url;
      })
      .catch(() => {
        button.hidden = true;
      });
  }
  img.alt = "Selected PDF region";
  img.draggable = false;
  const hideIfMissing = function () {
    if (!img.naturalWidth) button.hidden = true;
  };
  img.addEventListener("error", hideIfMissing, { once: true });
  img.addEventListener("load", hideIfMissing, { once: true });
  button.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    openImageLightbox(img.currentSrc || img.src, img.alt, button);
  });
  button.appendChild(img);
  return button;
}

/** The same complete Ask origin leads both the canvas card and the reader. */
export function buildOriginContext(node, surface) {
  if (!node.origin || (node.origin.kind === "note" && surface !== "reader")) return null;
  const quote = node.origin.selected_text || "";
  const question = displayQuestionForOrigin(node.origin);
  const crop = buildOriginCrop(node, surface);
  if (!quote && !question && !crop && !originAttachmentNames(node).length) return null;
  const context = document.createElement("div");
  context.className = "origin-context " + (surface === "reader" ? "reader-context" : "origin-quote");
  if (quote) {
    const selection = document.createElement("blockquote");
    selection.className = "origin-selection";
    selection.textContent = quote;
    context.appendChild(selection);
  }
  if (crop) context.appendChild(crop);
  if (question) {
    const prompt = document.createElement("div");
    prompt.className = "origin-question";
    prompt.textContent = question;
    context.appendChild(prompt);
  }
  appendOriginAttachmentThumbnails(context, node);
  return context;
}

async function renderOriginRegion(pdf, anchor) {
  const lease = await acquirePdfDocument({
    key: "origin:" + pdf.source.sha256,
    url: resolveAssetUrl(pdf.source.asset),
  });
  try {
    const result = await renderPdfRegion({
      document: lease.document,
      pageNumber: anchor.fragments[0].page,
      anchor,
      maxLongEdge: 1200,
      createSurface(width, height) {
        const surface = document.createElement("canvas");
        surface.width = width;
        surface.height = height;
        return { surface, context: surface.getContext("2d", { alpha: false }) };
      },
      encode: (surface) => surface.toDataURL("image/png"),
    });
    return result.encoded;
  } finally {
    lease.release();
  }
}
