/** @protects reducer browser parity capability contracts. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";
import { chromium } from "playwright";
import { createHoleState, holeStateToHole, reduceHoleEvent } from "../../src/core/hole/reduce.js";
import { CANVAS_SHELL } from "../../src/core/html/shell.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const cases = JSON.parse(await fs.readFile(path.join(ROOT, "test/fixtures/reducer-goldens/cases.json"), "utf8"));

function summarizeEffects(effects) {
  const out = { ...effects };
  if (out.createdNode) { out.createdNodeId = out.createdNode.id; delete out.createdNode; }
  if (out.answeredNode) { out.answeredNodeId = out.answeredNode.id; delete out.answeredNode; }
  return out;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  if (Object.isFrozen(value)) return value;
  seen.add(value);
  if (value instanceof Map) {
    for (const [key, entry] of value) { deepFreeze(key, seen); deepFreeze(entry, seen); }
    const rejectMutation = () => { throw new TypeError("Cannot mutate frozen Map"); };
    Object.defineProperties(value, { set: { value: rejectMutation }, delete: { value: rejectMutation }, clear: { value: rejectMutation } });
  } else {
    for (const entry of Object.values(value)) deepFreeze(entry, seen);
  }
  return Object.freeze(value);
}

function runCorpus(api, corpus) {
  return corpus.map((testCase) => {
    let state = api.createHoleState(testCase.initial);
    let effects = {};
    try {
      for (const step of testCase.events) {
        deepFreeze(state);
        deepFreeze(step.event);
        ({ state, effects } = api.reduceHoleEvent(state, step.event, step.options));
      }
      return { name: testCase.name, state: api.holeStateToHole(state), effects: summarizeEffects(effects) };
    } catch (error) {
      return { name: testCase.name, error: error.message };
    }
  });
}

const nodeResults = runCorpus({ createHoleState, holeStateToHole, reduceHoleEvent }, cases);
const bundle = await esbuild.build({
  stdin: { contents: `import { createHoleState, holeStateToHole, reduceHoleEvent } from "./src/core/hole/reduce.js"; import { createRabbitholeUi } from "./src/ui/composition.js"; globalThis.ReducerUnderTest = { createHoleState, holeStateToHole, reduceHoleEvent, createRabbitholeUi };`, resolveDir: ROOT, sourcefile: "reducer-browser-entry.js" },
  bundle: true, format: "iife", target: "es2018", write: false, logLevel: "silent",
});

const browser = await chromium.launch();
let browserResults;
let paintedCases = 0;
try {
  const page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><title>Reducer conformance</title>");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  browserResults = await page.evaluate(({ corpus, runner, summarizer, freezer }) => {
    const run = (0, eval)(`(() => { const summarizeEffects = ${summarizer}; const deepFreeze = ${freezer}; return ${runner}; })()`);
    return run(globalThis.ReducerUnderTest, corpus);
  }, { corpus: cases, runner: runCorpus.toString(), summarizer: summarizeEffects.toString(), freezer: deepFreeze.toString() });
  const dompurify = await fs.readFile(require.resolve("dompurify/dist/purify.min.js"), "utf8");
  for (const result of nodeResults) {
    if (!result.state?.root_id || !Array.isArray(result.state.nodes) || result.state.nodes.length === 0) continue;
    await page.setContent(CANVAS_SHELL);
    await page.addScriptTag({ content: dompurify });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const painted = await page.evaluate(async (hole) => {
      const runtime = globalThis.ReducerUnderTest.createRabbitholeUi({
        hydration: { root_id: hole.root_id, nodes: hole.nodes, frozen: true },
      });
      const cards = [...document.querySelectorAll("#world .card[data-id]")].map((card) => ({
        id: card.dataset.id,
        title: card.querySelector(":scope > .card-head .card-title")?.textContent || "",
      }));
      await runtime.dispose();
      return cards;
    }, result.state);
    assert(painted.length > 0, `${result.name}: actual canvas painter should materialize reducer nodes`);
    if (result.state.nodes.some((node) => node.id === result.state.root_id)) {
      assert(painted.some((card) => card.id === result.state.root_id), `${result.name}: actual canvas painter should materialize the root card`);
    }
    for (const card of painted) {
      const node = result.state.nodes.find((candidate) => candidate.id === card.id);
      assert(node, `${result.name}: painted card ${card.id} must come from reducer state`);
      assert.equal(card.title, node.title || "…", `${result.name}: painted title must match the reducer projection`);
    }
    paintedCases += 1;
  }
} finally {
  await browser.close();
}

assert.deepEqual(browserResults, nodeResults, "Node and browser must produce identical reducer projections");
console.log(`ok reducer browser parity: ${cases.length} goldens match node projections and ${paintedCases} paint the real canvas`);
