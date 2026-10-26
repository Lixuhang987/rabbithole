export function syncCardTitle(node) {
  const titleEl = node.titleEl;
  if (!titleEl || titleEl.isContentEditable) return;
  const heading = node.bodyEl?.querySelector(":scope > .doc-content > h1")?.textContent.trim();
  const title = heading || node.title || "";
  titleEl.textContent = title || "…";
  titleEl.title = title;
}
