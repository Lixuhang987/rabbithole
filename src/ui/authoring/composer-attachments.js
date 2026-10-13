import { ATTACHMENT_LIMIT_MESSAGE, MAX_ASK_ATTACHMENTS } from "../../core/attachments.js";
import { clipboardImageFiles, normalizeClipboardImage } from "../clipboard-image.js";
import { deleteAsset, flashHint, putAsset } from "../core.js";
import { createCleanupScope } from "../kit/scope.js";
import { wirePastedImages } from "./note-editor.js";

// Draft images stay in memory until the surface commits. The host receives
// durable asset names, never preview URLs, for both Ask and Note.
export function createComposerAttachments({ text, actions, onChange, active = () => true }) {
  const scope = createCleanupScope();
  const images = [];
  const strip = document.createElement("div");
  strip.className = "paste-attachment-strip";
  strip.hidden = true;
  actions.before(strip);
  const pasteRevisions = new WeakMap();
  let pending = 0;
  let uploading = false;
  let revision = 0;

  function render() {
    strip.replaceChildren();
    strip.hidden = !images.length;
    for (const attachment of images) {
      const item = document.createElement("div");
      item.className = "paste-attachment";
      const image = document.createElement("img");
      image.src = attachment.previewUrl;
      image.alt = "Pasted image";
      image.draggable = false;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "paste-attachment-remove";
      remove.setAttribute("aria-label", "Remove pasted image");
      remove.title = "Remove image";
      remove.textContent = "×";
      remove.disabled = uploading;
      remove.dataset.attachmentIndex = String(images.indexOf(attachment));
      item.append(image, remove);
      strip.appendChild(item);
    }
  }

  scope.listen(strip, "click", (event) => {
    const remove = event.target.closest?.(".paste-attachment-remove");
    if (!remove || uploading) return;
    event.preventDefault();
    event.stopPropagation();
    const [image] = images.splice(Number(remove.dataset.attachmentIndex), 1);
    if (image) URL.revokeObjectURL(image.previewUrl);
    render();
    onChange();
    text.focus({ preventScroll: true });
  });

  wirePastedImages({
    target: text,
    listen: scope.listen,
    readFiles: (event) => {
      const files = clipboardImageFiles(event);
      files.forEach((file) => pasteRevisions.set(file, revision));
      return files;
    },
    limit: MAX_ASK_ATTACHMENTS,
    count: () => images.length,
    active: () => !scope.disposed && !uploading && !text.disabled && active(),
    normalize: async (file) => {
      const started = pasteRevisions.get(file);
      return { ...(await normalizeClipboardImage(file)), revision: started };
    },
    accept: (image) => {
      if (image.revision !== revision) return;
      images.push({ ...image, previewUrl: URL.createObjectURL(image.blob) });
      render();
    },
    onLimit: () => flashHint(ATTACHMENT_LIMIT_MESSAGE),
    onError: () => flashHint("Couldn't paste that image. Try a smaller image."),
    onPending: (count) => {
      pending = count;
      if (!scope.disposed) onChange();
    },
    onSettled: () => {
      if (!scope.disposed) onChange();
    },
  });

  function reset() {
    revision += 1;
    images.splice(0).forEach((image) => URL.revokeObjectURL(image.previewUrl));
    uploading = false;
    text.readOnly = false;
    render();
  }
  scope.addCleanup(() => {
    reset();
    strip.remove();
  });

  return {
    get hasDraft() {
      return !!text.value.trim() || images.length > 0 || pending > 0;
    },
    get busy() {
      return uploading || pending > 0;
    },
    reset,
    dispose: scope.dispose,
    async submit(commit) {
      if (uploading || pending || scope.disposed || !active()) return;
      if (!images.length) return commit([], text.value.trim());
      const started = revision;
      const draftText = text.value.trim();
      const names = images.map((image) => image.name);
      const uploaded = [];
      uploading = true;
      text.readOnly = true;
      render();
      onChange();
      let committed = false;
      try {
        for (const image of images.slice()) {
          const response = await putAsset(image.name, image.blob);
          if (!response?.ok) throw new Error("Image upload failed");
          uploaded.push(image.name);
          if (scope.disposed || revision !== started || !active()) return;
        }
        committed = !!commit(names, draftText);
        if (committed) {
          reset();
          onChange();
        }
      } catch (_error) {
        if (!scope.disposed && revision === started) flashHint("Couldn't save those images — try again.");
      } finally {
        if (!committed) await Promise.allSettled(uploaded.map((name) => deleteAsset(name)));
        if (!scope.disposed && revision === started) {
          uploading = false;
          text.readOnly = false;
          render();
          onChange();
        }
      }
    },
  };
}

export function noteWithImages(text, names) {
  return [text, ...names.map((name) => `![Pasted image](asset:${name})`)].filter(Boolean).join("\n\n");
}
