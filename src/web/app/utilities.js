import { systemClock } from "../../core/clock.js";

export function isPdfFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return /\.pdf$/.test(name) || type === "application/pdf";
}

export function isRabbitholeFile(file) { return /\.rabbithole$/i.test(file?.name || ""); }

export function isSnapshotFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return /\.html?$/.test(name) || type === "text/html";
}

export function isMarkdownFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return /\.(md|markdown)$/.test(name) || type === "text/markdown" || type === "text/plain" || type === "application/json";
}

export function isSingleHttpUrl(value) {
  const text = String(value || "").trim();
  if (!text || /\s/.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch { return false; }
}

export function formatRelativeDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Updated at an unknown time";
  const deltaSeconds = Math.round((date.getTime() - systemClock.now()) / 1000);
  const abs = Math.abs(deltaSeconds);
  /** @type {Array<[number, Intl.RelativeTimeFormatUnit, number]>} */
  const ranges = [[60, "second", 1], [3600, "minute", 60], [86400, "hour", 3600], [2592000, "day", 86400], [31536000, "month", 2592000], [Infinity, "year", 31536000]];
  try {
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    const [, unit, divisor] = ranges.find(([limit]) => abs < limit) || ranges[ranges.length - 1];
    return `Updated ${formatter.format(Math.round(deltaSeconds / divisor), unit)}`;
  } catch { return date.toLocaleString(undefined, { month: "short", day: "numeric" }); }
}

export function isAuthLikeError(error) {
  return error?.status === 401 || error?.status === 403 || error?.code === "unauthorized" || /401|403|unauthorized|forbidden/i.test(error?.message || String(error));
}

export function autoGrowTextarea(textarea, maxHeight) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(maxHeight, textarea.scrollHeight)}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

export function isEditableTarget(target) { return !!target?.closest?.("input, textarea, select, [contenteditable='true']"); }

export function safeLocalStorageGet(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

export function safeLocalStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
