import { validateImageAssetName } from "../core/assets.js";
import { MAX_ASK_ATTACHMENTS } from "../core/attachments.js";
import { openImageLightbox } from "./image-ux.js";
import { resolveAssetUrl } from "./renderer.js";

export function originAttachmentNames(node) {
  if (!Array.isArray(node?.origin?.attachment_assets)) return [];
  const names = [];
  for (const rawName of node.origin.attachment_assets) {
    try {
      names.push(validateImageAssetName(rawName));
    } catch {}
    if (names.length === MAX_ASK_ATTACHMENTS) break;
  }
  return names;
}

export function appendOriginAttachmentThumbnails(container, node) {
  const names = originAttachmentNames(node);
  if (!names.length) return null;
  const strip = document.createElement("div");
  strip.className = "origin-attachment-strip";
  for (const name of names) {
    const image = document.createElement("img");
    image.src = resolveAssetUrl(name);
    image.alt = "Pasted image";
    image.loading = "eager";
    image.draggable = false;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "origin-attachment";
    button.setAttribute("aria-label", "Open pasted image");
    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openImageLightbox(image.currentSrc || image.src, image.alt, button);
    });
    button.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    });
    button.appendChild(image);
    strip.appendChild(button);
  }
  container.appendChild(strip);
  return strip;
}
