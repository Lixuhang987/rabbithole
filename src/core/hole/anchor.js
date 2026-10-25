/** @param {unknown} value */
/** @param {unknown} value */
export function normalizeBlockAnchor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = /** @type {Record<string, any>} */ (value);
  const blockId = String(raw.block_id || "").trim();
  const selectedText = String(raw.selected_text || "").trim().slice(0, 2000);
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(blockId) || !selectedText) return null;
  return { block_id: blockId, selected_text: selectedText };
}

/** @param {unknown} anchor @returns {any} */
export function normalizeAnchor(anchor) {
  if (!anchor) return null;
  if (Object.prototype.hasOwnProperty.call(/** @type {object} */ (anchor), "block")) {
    const block = normalizeBlockAnchor(/** @type {{ block?: unknown }} */ (anchor).block);
    return block ? { block } : null;
  }
  const start = Math.max(0, Number(/** @type {{ offset_start?: unknown }} */ (anchor).offset_start) || 0);
  const end = Math.max(start, Number(/** @type {{ offset_end?: unknown }} */ (anchor).offset_end) || start);
  /** @type {{ offset_start: number, offset_end: number }} */
  const out = { offset_start: start, offset_end: end };
  return out;
}
