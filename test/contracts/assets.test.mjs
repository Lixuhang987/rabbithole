/** @protects asset Markdown resolution and trust boundaries. */
import assert from "node:assert/strict";
import { renderMarkdownToHtml } from "../../src/core/markdown.js";
function assertIncludes(haystack, needle, message) { assert(haystack.includes(needle), message); }
async function runMarkdownFixtures() {
  const html = await renderMarkdownToHtml("![fig](asset:diagram-1.png)", {
    baseUrl: "https://example.com/docs/page.md",
  });
  assertIncludes(html, 'src="/assets/diagram-1.png"', "asset images should resolve to root-relative asset URLs");
  assert(!html.includes("https://example.com"), "asset images should not resolve against base_url");

  const link = await renderMarkdownToHtml("[fig](asset:diagram-1.png)", {
    baseUrl: "https://example.com/docs/page.md",
  });
  assert(!link.includes("<a "), "asset: should not be accepted for links");
  assertIncludes(link, "fig", "stripping an asset: link should preserve link text");

  const missing = await renderMarkdownToHtml("![missing](asset:missing.png)", {
    assetNames: new Set(["diagram-1.png"]),
  });
  assert(!missing.includes("<img"), "unknown asset names should render like unsafe images");
  assertIncludes(missing, "missing");

  const invalid = await renderMarkdownToHtml("![bad](asset:../diagram-1.png)");
  assert(!invalid.includes("<img"), "invalid asset names should render like unsafe images");
  assertIncludes(invalid, "bad");

  console.log("ok assets: markdown asset: images, link rejection, base_url isolation");
}

await runMarkdownFixtures();
