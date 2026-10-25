const IMAGE_ASSET_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];
const ALLOWED_ASSET_EXTENSIONS = IMAGE_ASSET_EXTENSIONS;
export const MAX_ASSETS_PER_CALL = 50;
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(ALLOWED_ASSET_EXTENSIONS);
const IMAGE_EXTENSIONS = new Set(IMAGE_ASSET_EXTENSIONS);
const ASSET_NAME_RE = /^([a-z0-9][a-z0-9_-]*)\.([a-z0-9]+)$/;
const ASSET_URL_RE = /^asset:(.*)$/i;
const ASSET_REF_RE = /\basset:([a-z0-9][a-z0-9_-]*\.[a-z0-9]+)/gi;

/** @param {unknown} name */
function getAssetExtension(name) {
  const match = ASSET_NAME_RE.exec(String(name ?? ""));
  if (!match) return null;
  const ext = match[2] ?? "";
  return ALLOWED_EXTENSIONS.has(ext) ? ext : null;
}

/** @param {unknown} name */
function isValidAssetName(name) {
  return getAssetExtension(name) !== null;
}

/** @param {unknown} name */
function isValidImageAssetName(name) {
  const ext = getAssetExtension(name);
  return ext !== null && IMAGE_EXTENSIONS.has(ext);
}

/**
 * @param {unknown} name
 * @param {string} [paramName]
 */
export function validateAssetName(name, paramName = "asset name") {
  const value = String(name ?? "");
  if (!isValidAssetName(value)) {
    throw new Error(
      `${paramName} must be a lowercase filename with one extension from ` +
        ALLOWED_ASSET_EXTENSIONS.join(", ") +
        `; got ${JSON.stringify(name)}`
    );
  }
  return value;
}

/**
 * @param {unknown} name
 * @param {string} [paramName]
 */
export function validateImageAssetName(name, paramName = "image asset name") {
  const value = validateAssetName(name, paramName);
  if (!isValidImageAssetName(value)) {
    throw new Error(`${paramName} must use an image extension; got ${JSON.stringify(name)}`);
  }
  return value;
}

/** @param {unknown} name */
export function getAssetContentType(name) {
  const ext = getAssetExtension(name);
  if (!ext) validateAssetName(name);
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      throw new Error(`Unsupported asset extension: ${ext}`);
  }
}

/** @param {string} name */
export function defaultAssetUrlResolver(name) {
  const slash = String.fromCharCode(47);
  return slash + "assets" + slash + name;
}

/**
 * @param {unknown} raw
 * @param {{assetNames?: Set<string> | null, resolveAssetUrl?: (name: string) => string | null}} [options]
 */
export function resolveAssetMarkdownImageUrl(raw, { assetNames = null, resolveAssetUrl = defaultAssetUrlResolver } = {}) {
  const match = ASSET_URL_RE.exec(String(raw ?? ""));
  if (!match) return undefined;

  const name = match[1] ?? "";
  if (!isValidImageAssetName(name)) return null;
  if (assetNames && !assetNames.has(name)) return null;
  return resolveAssetUrl(name);
}

/** @param {unknown} markdown */
function extractAssetRefsFromMarkdown(markdown) {
  const refs = new Set();
  for (const match of String(markdown ?? "").matchAll(ASSET_REF_RE)) {
    const name = (match[1] ?? "").toLowerCase();
    if (isValidImageAssetName(name)) refs.add(name);
  }
  return refs;
}

/** Single asset-reference view used by deletion candidates, survivors, and undo. */
/** @param {any} node */
export function extractNodeAssetRefs(node) {
  const refs = new Set(extractAssetRefsFromMarkdown(node?.markdown));
  if (Array.isArray(node?.origin?.attachment_assets)) {
    for (const name of node.origin.attachment_assets) {
      try { refs.add(validateImageAssetName(name)); } catch {}
    }
  }
  return refs;
}
