/** @protects ui lifecycle capability contracts. */
import assert from "node:assert/strict";
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import { CANVAS_SHELL } from "../../src/core/html/shell.js";

const bundle = await esbuild.build({
  entryPoints: ["src/ui/composition.js"],
  bundle: true,
  write: false,
  format: "iife",
  globalName: "RabbitholeUiTest",
  platform: "browser",
  target: "es2018",
  external: ["pdfjs-dist/build/pdf.mjs"],
  logLevel: "silent",
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.setContent(CANVAS_SHELL);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const hydration = {
      hole_id: "mount-twice",
      root_id: "root",
      nodes: [],
      view_state: null,
      frozen: true,
    };
    const first = RabbitholeUiTest.createRabbitholeUi({ hydration });
    await first.dispose();
    const second = RabbitholeUiTest.createRabbitholeUi({ hydration });
    await second.dispose();
    return { first: first.disposed, second: second.disposed };
  });
  assert.deepEqual(result, { first: true, second: true });
  console.log("ok UI lifecycle: one document mounts, disposes, and mounts again without retained ownership");
} finally {
  await browser.close();
}
