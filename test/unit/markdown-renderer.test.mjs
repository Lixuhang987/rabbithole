/** @protects markdown renderer capability contracts. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renderMarkdownToHtml } from "../../src/core/markdown.js";
import { snapshotFixture } from "../support/snapshot-fixture.mjs";
import { getUiAssets } from "../../src/node/shared/dist-assets.js";

process.env.RABBITHOLE_NO_BROWSER = "1";
process.env.RABBITHOLE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-markdown-renderer-"));

const KATEX_CSS_SENTINEL = ".katex .katex-version::after";
const CODE_COPY_CSS_SENTINEL = ".md .code-copy{position:absolute;top:7px;right:7px;";
const CODE_COPY_MARKUP_SENTINEL = '<span class="ic-check" hidden>';

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function assertNoRawHtmlLeak(html) {
  assert(!html.includes("<script>"), "raw script tag should not pass through markdown");
  assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "raw HTML should be escaped");
}

async function runMarkdownFixtures() {
  const fixtures = [
    {
      name: "Chinese double-star emphasis next to punctuation",
      markdown: [
        "这是**重点（解释）**后面的内容，含**“引号”**和**重点：**说明。",
        "嵌套**重点（*说明*）**文字，普通 **English bold**。",
        "代码 `**重点（解释）**`，转义 \\*\\*重点\\*\\*，未闭合 **重点。",
        "",
        "```text",
        "**重点（解释）**",
        "```",
      ].join("\n"),
      assert(html) {
        assert(html.includes("这是<strong>重点（解释）</strong>后面的内容"));
        assert(html.includes("<strong>“引号”</strong>"));
        assert(html.includes("<strong>重点：</strong>说明"));
        assert(html.includes("<strong>重点（<em>说明</em>）</strong>文字"));
        assert(html.includes("<strong>English bold</strong>"));
        assert(html.includes("<code>**重点（解释）**</code>"));
        assert(html.includes("转义 **重点**，未闭合 **重点。"));
        assert.equal(count(html, "**重点（解释）**"), 2);
      },
    },
    {
      name: "all four math delimiters",
      markdown: [
        "Inline dollar $a+b$ and paren \\(c+d\\).",
        "",
        "$$",
        "e=f",
        "$$",
        "",
        "\\[",
        "g=h",
        "\\]",
      ].join("\n"),
      assert(html) {
        assert.equal(count(html, 'class="katex"'), 4);
        assert.equal(count(html, 'class="katex-display"'), 2);
      },
    },
    {
      name: "inline dollar boundary rules reject prices and spacing",
      markdown: "Prices $5 and $10 stay literal. Spacing $ x$ and $x $ stays literal. $x$5 stays literal. Real $x$ works.",
      assert(html) {
        assert.equal(count(html, 'class="katex"'), 1);
        assert(html.includes("$5 and $10"));
        assert(html.includes("$ x$"));
        assert(html.includes("$x $"));
        assert(html.includes("$x$5"));
      },
    },
    {
      name: "code spans shield dollars",
      markdown: 'Code span `const price = "$5"` and math $x$.',
      assert(html) {
        assert.equal(count(html, 'class="katex"'), 1);
        assert(html.includes("<code>const price = &quot;$5&quot;</code>"));
      },
    },
    {
      name: "highlight known languages and keep unknown plain",
      markdown: [
        "```js",
        "const n = 1 < 2;",
        "```",
        "",
        "```python",
        "def add(a, b):",
        "    return a + b",
        "```",
        "",
        "```not-a-language",
        "<tag>",
        "```",
      ].join("\n"),
      assert(html) {
        assert(html.includes('class="language-js hljs"'));
        assert(html.includes('class="language-python hljs"'));
        assert(html.includes("hljs-keyword"));
        assert(html.includes('class="language-not-a-language"'));
        assert(html.includes("&lt;tag&gt;"));
        assert(!html.includes('class="language-not-a-language hljs"'));
      },
    },
    {
      name: "math inside lists and blockquotes",
      markdown: ["> Quote has $q$.", "", "- List has \\(l\\)."].join("\n"),
      assert(html) {
        assert(html.includes("<blockquote>"));
        assert(html.includes("<ul>"));
        assert.equal(count(html, 'class="katex"'), 2);
      },
    },
    {
      name: "bad TeX falls back to source code",
      markdown: "Bad math $\\badcommand{$ does not throw.",
      assert(html) {
        assert(html.includes('<code class="math-source">\\badcommand{</code>'));
        assert(!html.includes("katex-error"));
      },
    },
    {
      name: "unclosed display math is pending and source is held",
      markdown: ["Intro.", "$$", "a^2 + b^2"].join("\n"),
      assert(html) {
        assert(html.includes('class="math-pending"'));
        assert(html.includes("Intro."));
        assert(!html.includes("$$"));
        assert(!html.includes("a^2 + b^2"));
      },
    },
    {
      name: "raw HTML remains escaped",
      markdown: "<script>alert(1)</script>",
      assert: assertNoRawHtmlLeak,
    },
    {
      name: "frozen SVG data URLs retain the svg+xml MIME spelling",
      markdown: "![vector](data:image/svg+xml;base64,PHN2Zy8+)",
      assert(html) {
        assert(html.includes('<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="vector">'));
      },
    },
    {
      name: "pasted asset images carry only the pasted-image marker",
      markdown: "![paste](asset:paste-deadbeef.png) ![diagram](asset:diagram-1.png)",
      assert(html) {
        assert(html.includes('<img src="/assets/paste-deadbeef.png" alt="paste" data-rh-pasted="1">'));
        assert(html.includes('<img src="/assets/diagram-1.png" alt="diagram">'));
        assert(!html.includes('alt="diagram" data-rh-pasted'));
      },
    },
    {
      name: "single tildes remain literal approximation notation",
      markdown: "Rates price ~zero cuts (~77% probability); the structural bid is ~1,000t/yr.",
      assert(html) {
        assert.equal(count(html, "<del>"), 0);
        assert(html.includes("~zero cuts"));
        assert(html.includes("~77% probability"));
        assert(html.includes("~1,000t/yr"));
      },
    },
    {
      name: "only double tildes create strikethrough",
      markdown: [
        "Keep ~one~ and ~77%, delete ~~this **clearly**~~.",
        "",
        "Keep \\~escaped and `~code~`.",
      ].join("\n"),
      assert(html) {
        assert.equal(count(html, "<del>"), 1);
        assert(html.includes("<del>this <strong>clearly</strong></del>"));
        assert(html.includes("Keep ~one~ and ~77%"));
        assert(html.includes("Keep ~escaped and <code>~code~</code>"));
      },
    },
    {
      name: "distant approximation tildes cannot delete intervening prose",
      markdown: [
        "Fed funds futures now price ~zero cuts and probable hikes through 2026",
        "(a market showed ~77% probability). The structural official-sector bid",
        "(~1,000t/yr) is not carry-priced.",
      ].join(" "),
      assert(html) {
        assert.equal(count(html, "<del>"), 0);
        assert(html.includes("~zero cuts"));
        assert(html.includes("~77% probability"));
        assert(html.includes("(~1,000t/yr)"));
      },
    },
  ];

  for (const fixture of fixtures) {
    const html = await renderMarkdownToHtml(fixture.markdown);
    fixture.assert(html);
    console.log(`ok markdown: ${fixture.name}`);
  }
}

async function assertPageAssembly() {
  const rootMarkdown = [
    "Root with $x^2$.",
    "",
    "```js",
    "const x = 1;",
    "```",
  ].join("\n");
  const rootNode = {
    id: "root",
    parent_id: null,
    title: "Root",
    markdown: rootMarkdown,
    origin: null,
    position: { x: 0, y: 0 },
    size: null,
    font_scale: 1,
    collapsed: false,
    status: "answered",
    read: true,
    created_at: new Date().toISOString(),
  };

  const exportHtml = await snapshotFixture({ title: "Markdown Renderer Test", root_id: "root", nodes: [rootNode] });
  const label = "snapshot";
  const html = exportHtml;
  assert.equal(count(html, KATEX_CSS_SENTINEL), 1);
  assert.equal(count(html, CODE_COPY_CSS_SENTINEL), 1);
  assert(html.includes(CODE_COPY_MARKUP_SENTINEL));
  assert.equal(count(html, "data:font/woff2;base64,"), 20);
  assert(!/fonts\/KaTeX_[^)]+\.(?:woff|ttf)/.test(html));
  assert(html.includes("Root with $x^2$."));
  assert(html.includes("rabbithole-shared-markdown-renderer-v1"));
  const liveHtml = html;
    const scriptMatch = liveHtml.match(/<script>\n([\s\S]*)\n<\/script>/);
    assert(scriptMatch, "assembled HTML should contain one inline script");
    const scriptPath = path.join(process.env.RABBITHOLE_DIR, "assembled-client.js");
    await fs.writeFile(scriptPath, scriptMatch[1], "utf8");
    const check = spawnSync(process.execPath, ["--check", scriptPath], { encoding: "utf8" });
    assert.equal(check.status, 0, check.stderr || check.stdout);

    const stylesheetBytes = Buffer.byteLength((await getUiAssets()).stylesheetText, "utf8");
    const pageBytes = Buffer.byteLength(liveHtml, "utf8");
    console.log(`ok page assembly: UI stylesheet ${stylesheetBytes} bytes, live page ${pageBytes} bytes`);

}

await runMarkdownFixtures();
await assertPageAssembly();
console.log("markdown renderer verification passed");
