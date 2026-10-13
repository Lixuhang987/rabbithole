/** @protects reducer capability contracts. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHoleState, holeStateToHole, holeStateToHydrationNodes, reduceHoleEvent } from "../../src/core/hole/reduce.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cases = JSON.parse(await fs.readFile(path.join(ROOT, "test/fixtures/reducer-goldens/cases.json"), "utf8"));

const hydrationState = createHoleState({
  hole_id: "hydration-golden",
  title: "Hydration golden",
  root_id: "root",
  nodes: [
    { id: "root", origin: { private: "web-root" }, extra: "must-not-leak", extensions: { progress: ["雪", { score: 2 }] } },
    { id: "child", parent_id: "root", title: "Child", markdown: "Body", origin: { lens: "deeper" } },
  ],
});
const hydrationGolden = [
  { id: "root", parent_id: null, title: "", markdown: "", base_url: null, base_url_source: null, origin: { private: "web-root" }, position: { x: 0, y: 0 }, size: null, font_scale: 1, collapsed: false, status: "answered", read: false, extensions: { progress: ["雪", { score: 2 }] } },
  { id: "child", parent_id: "root", title: "Child", markdown: "Body", base_url: null, base_url_source: null, origin: { lens: "deeper" }, position: { x: 0, y: 0 }, size: null, font_scale: 1, collapsed: false, status: "answered", read: false, extensions: {} },
];
assert.deepEqual(holeStateToHydrationNodes(hydrationState), hydrationGolden, "Browser hydration uses the canonical exact-key node projection");
assert.deepEqual(
  holeStateToHydrationNodes(hydrationState, { suppressRootOrigin: true }),
  [{ ...hydrationGolden[0], origin: null }, hydrationGolden[1]],
  "web hydration preserves its intentional root-origin suppression"
);
console.log("ok reducer: canonical hydration-node projection preserves canonical browser projections");

// A standalone ask is disconnected in the graph while borrowing root context
// for inherited document metadata. Its exact node state must survive the same
// serialize/delete/restore cycle the UI's undo toast stages locally.
{
  const initial = createHoleState({
    hole_id: "standalone-ask",
    title: "Standalone ask",
    root_id: "root",
    nodes: [{
      id: "root", parent_id: null, title: "Root", markdown: "Root context",
      base_url: "https://example.test/docs/", base_url_source: "explicit",
    }],
  });
  let result = reduceHoleEvent(initial, {
    type: "branch_request",
    parent_id: null,
    node_id: "floating-ask",
    selected_text: "must be ignored",
    question: "How does this fit together?",
    anchor: { offset_start: 1, offset_end: 8 },
    branch_type: "selection",
    position: { x: 240, y: -35 },
    size: { w: 300, h: 180 },
  }, { now: "2026-08-13T00:00:00.000Z" });
  const ask = result.state.nodes.get("floating-ask");
  assert.equal(ask.parent_id, null, "branch_request permits an explicitly parentless ask");
  assert.deepEqual(ask.position, { x: 240, y: -35 });
  assert.deepEqual(ask.size, { w: 300, h: 180 });
  assert.equal(ask.base_url, "https://example.test/docs/");
  assert.equal(ask.base_url_source, "inherited");
  assert.deepEqual(ask.origin, {
    selected_text: "",
    question: "How does this fit together?",
    lens: null,
    anchor: null,
    branch_type: "followup",
  }, "parentless asks normalize to whole-hole follow-up semantics");

  result = reduceHoleEvent(result.state, {
    type: "branch_request", parent_id: "floating-ask", node_id: "ask-child", question: "And then?",
  }, { now: "2026-08-13T00:00:01.000Z" });
  const undoSnapshot = holeStateToHole(result.state);
  const deleted = reduceHoleEvent(result.state, { type: "delete_node", node_id: "floating-ask" });
  assert.deepEqual(new Set(deleted.effects.deletedNodeIds), new Set(["floating-ask", "ask-child"]),
    "deleting a parentless ask still removes its whole descendant subtree");
  const restored = createHoleState(undoSnapshot);
  assert.deepEqual(holeStateToHole(restored), undoSnapshot,
    "the exact parentless-ask subtree round-trips for local delete undo");
}
console.log("ok reducer: standalone asks retain null graph parents, root context, and exact delete-undo state");

function summarizeEffects(effects) {
  const out = { ...effects };
  if (out.createdNode) {
    out.createdNodeId = out.createdNode.id;
    delete out.createdNode;
  }
  if (out.answeredNode) {
    out.answeredNodeId = out.answeredNode.id;
    delete out.answeredNode;
  }
  return out;
}

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  if (Object.isFrozen(value)) return value;
  seen.add(value);
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      deepFreeze(key, seen);
      deepFreeze(entry, seen);
    }
    const rejectMutation = () => { throw new TypeError("Cannot mutate frozen Map"); };
    Object.defineProperties(value, {
      set: { value: rejectMutation },
      delete: { value: rejectMutation },
      clear: { value: rejectMutation },
    });
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

function assertGoldens(results, environment) {
  assert.equal(results.length, cases.length);
  for (let index = 0; index < cases.length; index += 1) {
    const testCase = cases[index];
    const actual = results[index];
    assert.equal(actual.name, testCase.name);
    if (testCase.expected_error) {
      assert.equal(actual.error, testCase.expected_error, `${environment}: ${testCase.name}`);
    } else {
      assert.deepEqual(actual.state, testCase.expected, `${environment}: ${testCase.name} state`);
      assert.deepEqual(actual.effects, testCase.expected_effects, `${environment}: ${testCase.name} effects`);
    }
  }
}

const nodeResults = runCorpus({ createHoleState, holeStateToHole, reduceHoleEvent }, cases);
assertGoldens(nodeResults, "node");

// First-class note creation is intentionally stricter than the reducer's
// tolerant presentation updates: a note is born complete or not inserted.
{
  const initial = createHoleState({
    hole_id: "notes",
    title: "Notes",
    root_id: "root",
    nodes: [{ id: "root", parent_id: null, title: "Root", markdown: "Root body" }],
  });
  const anchoredOrigin = {
    kind: "note",
    selected_text: "  exact phrase  ",
    anchor: { offset_start: -3, offset_end: 15 },
    branch_type: "ignored",
    unknown: "drop me",
  };
  const anchored = reduceHoleEvent(initial, {
    type: "node_create",
    id: "anchored-note",
    parent_id: "root",
    title: "  Margin note  ",
    markdown: "Remember **this**.",
    position: { x: 50, y: 75 },
    size: { w: 320, h: 180 },
    origin: anchoredOrigin,
  }, { now: "2026-08-11T00:00:00.000Z" });
  assert.deepEqual(anchored.state.nodes.get("anchored-note"), {
    id: "anchored-note",
    parent_id: "root",
    title: "Margin note",
    markdown: "Remember **this**.",
    base_url: null,
    base_url_source: null,
    origin: {
      kind: "note",
      selected_text: "exact phrase",
      anchor: { offset_start: 0, offset_end: 15 },
      branch_type: "selection",
    },
    position: { x: 50, y: 75 },
    size: { w: 320, h: 180 },
    font_scale: 1,
    collapsed: false,
    status: "answered",
    read: true,
    created_at: "2026-08-11T00:00:00.000Z",
    extensions: {},
  }, "node_create creates a complete anchored note");
  assert.equal(anchored.effects.createdNode.id, "anchored-note");

  const standalone = reduceHoleEvent(anchored.state, {
    type: "node_create",
    id: "standalone-note",
    markdown: "A hole-wide thought.",
    position: { x: -20, y: 10 },
    origin: { kind: "note", unknown: "drop me", anchor: { offset_start: 1, offset_end: 2 } },
  }, { now: "2026-08-11T00:00:01.000Z" });
  assert.equal(standalone.state.nodes.get("standalone-note").parent_id, null, "node_create permits a standalone note");
  assert.equal(standalone.state.nodes.get("standalone-note").status, "answered");
  assert.equal(standalone.state.nodes.get("standalone-note").title, "Note");
  assert.equal(standalone.state.nodes.get("standalone-note").read, true, "human-authored notes are born read");
  assert.deepEqual(standalone.state.nodes.get("standalone-note").origin, { kind: "note" }, "standalone note origins drop unknown and anchored-only keys");

  const recommitted = reduceHoleEvent(standalone.state, {
    type: "branch_request",
    node_id: "standalone-note",
    parent_id: null,
    question: "A hole-wide question.",
    branch_type: "followup",
  });
  assert.equal(recommitted.state.nodes.size, standalone.state.nodes.size,
    "branch_request retargets an existing note id instead of adding a second node");
  assert.deepEqual(recommitted.state.nodes.get("standalone-note").origin, {
    selected_text: "",
    question: "A hole-wide question.",
    lens: null,
    anchor: null,
    branch_type: "followup",
  }, "branch_request replaces the note origin with the ordinary ask origin");
  assert.equal(recommitted.state.nodes.get("standalone-note").status, "pending");
  assert.equal(recommitted.state.nodes.get("standalone-note").markdown, "");

  const publishedAnswer = reduceHoleEvent(standalone.state, {
    type: "node_create",
    id: "published-answer",
    parent_id: "root",
    title: "Agent result",
    markdown: "A completed model-authored document.",
    origin: null,
    position: { x: 500, y: 10 },
    size: { w: 420, h: 460 },
  }, { now: "2026-08-11T00:00:01.500Z" });
  assert.deepEqual(publishedAnswer.state.nodes.get("published-answer").origin, null,
    "node_create admits a completed answer document without manufacturing an ask origin");
  assert.equal(publishedAnswer.state.nodes.get("published-answer").status, "answered");
  assert.equal(publishedAnswer.state.nodes.get("published-answer").read, false,
    "agent-published answers arrive unread like ordinary answers");

  const agentNote = reduceHoleEvent(standalone.state, {
    type: "node_create",
    id: "agent-note",
    markdown: "An explicit agent annotation.",
    origin: { kind: "note", author: "agent" },
  });
  assert.deepEqual(agentNote.state.nodes.get("agent-note").origin, { kind: "note", author: "agent" },
    "agent note attribution survives normalization");

  // Docking is presentation and only means anything on a parent: it rides in
  // the extensions bag, leaves the note itself untouched, and clears when the
  // note is later given a place.
  const docked = reduceHoleEvent(standalone.state, {
    type: "node_create",
    id: "docked-note",
    parent_id: "root",
    markdown: "Kept on the card it marks.",
    origin: { kind: "note", selected_text: "Root", anchor: { offset_start: 0, offset_end: 4 }, instruction: "Keep this shape." },
    docked: true,
  }, { now: "2026-08-11T00:00:02.000Z" });
  const dockedNote = docked.state.nodes.get("docked-note");
  assert.deepEqual(dockedNote.extensions, { note: { docked: true } }, "node_create docks a note through the extensions bag");
  assert.deepEqual({ position: dockedNote.position, size: dockedNote.size }, { position: { x: 0, y: 0 }, size: null },
    "a docked note is created without canvas geometry");
  assert.deepEqual(dockedNote.origin, { kind: "note", selected_text: "Root", anchor: { offset_start: 0, offset_end: 4 }, branch_type: "selection", instruction: "Keep this shape." },
    "docking keeps semantic note instructions without putting presentation in origin");
  const placed = reduceHoleEvent(reduceHoleEvent(docked.state, {
    type: "node_extensions_patch", node_id: "docked-note", namespace: "note", value: {},
  }).state, { type: "node_update", node_id: "docked-note", position: { x: 550, y: 0 }, size: { w: 420, h: 460 } });
  assert.deepEqual(placed.state.nodes.get("docked-note").extensions, { note: {} }, "placing a note clears the docked flag");
  assert.deepEqual(placed.state.nodes.get("docked-note").size, { w: 420, h: 460 }, "placing a note gives it geometry");
  assert.equal(placed.state.nodes.get("docked-note").markdown, "Kept on the card it marks.", "placing a note never touches its words");
  const standaloneDocked = reduceHoleEvent(standalone.state, {
    type: "node_create", id: "docked-standalone", markdown: "No parent to dock to.", origin: { kind: "note" }, docked: true,
  });
  assert.deepEqual(standaloneDocked.state.nodes.get("docked-standalone").extensions, {},
    "a parentless note has no card to dock to and stays a window");

  assert.throws(
    () => reduceHoleEvent(standalone.state, { type: "node_create", id: "standalone-note", markdown: "Duplicate", origin: { kind: "note" } }),
    /Node standalone-note already exists/,
    "node_create rejects duplicate ids",
  );
  for (const markdown of [undefined, "   "]) {
    assert.throws(
      () => reduceHoleEvent(initial, { type: "node_create", id: `empty-${String(markdown)}`, markdown, origin: { kind: "note" } }),
      /Note markdown is required/,
      "node_create rejects missing or empty note markdown",
    );
  }
  assert.throws(
    () => reduceHoleEvent(initial, { type: "node_create", id: "orphan", parent_id: "missing", markdown: "Orphan", origin: { kind: "note" } }),
    /Parent node missing not found/,
    "node_create rejects a missing parent",
  );
  for (const origin of [{}, { kind: "answer" }]) {
    assert.throws(
      () => reduceHoleEvent(initial, { type: "node_create", id: `bad-origin-${JSON.stringify(origin)}`, markdown: "Nope", origin }),
      /origin must be null or kind "note"/,
      "node_create rejects every non-note, non-answer origin",
    );
  }
  assert.throws(
    () => reduceHoleEvent(initial, { type: "node_create", markdown: "Missing id", origin: { kind: "note" } }),
    /Node create id is required/,
    "node_create rejects a missing id",
  );

  const edited = reduceHoleEvent(standalone.state, {
    type: "node_update",
    node_id: "standalone-note",
    title: "  Revised thought  ",
    markdown: "Revised **note** body.",
  });
  assert.equal(edited.state.nodes.get("standalone-note").title, "Revised thought", "node_update accepts note titles");
  assert.equal(edited.state.nodes.get("standalone-note").markdown, "Revised **note** body.", "node_update accepts note markdown");
  const emptyEdit = reduceHoleEvent(edited.state, {
    type: "node_update",
    node_id: "standalone-note",
    markdown: "   ",
  });
  assert.equal(emptyEdit.state.nodes.get("standalone-note").markdown, "Revised **note** body.", "node_update ignores empty note markdown");

  const answerTitleEdited = reduceHoleEvent(edited.state, {
    type: "node_update",
    node_id: "root",
    title: "  Renamed root  ",
    markdown: "Must stay Root body",
    position: { x: 9, y: 4 },
  });
  assert.equal(answerTitleEdited.state.nodes.get("root").title, "Renamed root", "node_update accepts title patches for non-notes");
  assert.equal(answerTitleEdited.state.nodes.get("root").markdown, "Root body", "node_update ignores markdown patches for non-notes");
  assert.deepEqual(answerTitleEdited.state.nodes.get("root").position, { x: 9, y: 4 }, "non-note presentation updates retain existing semantics");
  const emptyTitle = reduceHoleEvent(answerTitleEdited.state, { type: "node_update", node_id: "root", title: "   " });
  assert.equal(emptyTitle.state.nodes.get("root").title, "Renamed root", "node_update ignores empty title patches");
}
console.log("ok reducer notes: note creation, all-node title patches, and note-only markdown patches");

// Immutability is an engine contract: changed nodes are replaced while unchanged
// nodes may remain shared. Frozen input makes mutation fail immediately.
const priorState = createHoleState({ root_id: "root", nodes: [{ id: "root", markdown: "before" }] });
const priorNode = priorState.nodes.get("root");
deepFreeze(priorState);
const mutationResult = reduceHoleEvent(priorState, { type: "node_progress", node_id: "root", markdown: "after" });
assert.equal(priorNode.markdown, "before");
assert.equal(priorState.nodes.get("root").markdown, "before");
assert.notStrictEqual(mutationResult.state.nodes.get("root"), priorNode);
assert.equal(mutationResult.state.nodes.get("root").markdown, "after");

// The ephemeral ordering ledger obeys the same frozen-input/copy-on-write
// contract, and stale progress preserves the entire state identity.
const taggedState = createHoleState({ root_id: "root", nodes: [{ id: "root", markdown: "before" }] });
const acceptedTagged = reduceHoleEvent(taggedState, {
  type: "node_progress", node_id: "root", markdown: "newer", run: { id: "run", seq: 2 },
});
const priorRuns = acceptedTagged.state.progressRuns;
deepFreeze(acceptedTagged.state);
const staleTagged = reduceHoleEvent(acceptedTagged.state, {
  type: "node_progress", node_id: "root", markdown: "older", run: { id: "run", seq: 1 },
});
assert.notStrictEqual(priorRuns, taggedState.progressRuns);
assert.deepEqual(priorRuns.get("root"), { id: "run", seq: 2 });
assert.strictEqual(staleTagged.state, acceptedTagged.state);
assert.strictEqual(staleTagged.state.progressRuns, priorRuns);
assert.equal(Object.hasOwn(holeStateToHole(acceptedTagged.state), "progressRuns"), false);
assert.equal(JSON.stringify(holeStateToHole(acceptedTagged.state)).includes("progressRuns"), false);

const heavyExtensionState = createHoleState({ root_id: "heavy", nodes: [{
  id: "heavy",
  markdown: "```check id=q1\n{}\n```",
  extensions: { pdf: { lines: Array.from({ length: 2000 }, (_, index) => ({ p: 1, s: index, e: index + 1 })) }, learn: { old: { selected: 0 } } },
}] });
const priorHeavyNode = heavyExtensionState.nodes.get("heavy");
const learnedHeavy = reduceHoleEvent(heavyExtensionState, {
  type: "block_state", node_id: "heavy", block_id: "q1", state: { selected: 1 },
}).state.nodes.get("heavy");
assert.strictEqual(learnedHeavy.extensions.pdf, priorHeavyNode.extensions.pdf,
  "updating one extension namespace should structurally share an untouched heavy PDF namespace");
assert.notStrictEqual(learnedHeavy.extensions.learn, priorHeavyNode.extensions.learn);
assert.equal(priorHeavyNode.extensions.learn.q1, undefined, "structural sharing must not mutate the previous learn namespace");

// Production hosts exclusively own their state and opt into map reuse so a
// long stream does not clone every node for every chunk. The public/default
// path above remains copy-on-write for embedders.
const ownedState = createHoleState({ root_id: "root", nodes: [{ id: "root", markdown: "before" }] });
const ownedNodes = ownedState.nodes;
const ownedResult = reduceHoleEvent(ownedState, { type: "node_progress", node_id: "root", markdown: "after" }, { mutate: true });
assert.strictEqual(ownedResult.state.nodes, ownedNodes);
assert.equal(ownedResult.state.nodes.get("root").markdown, "after");

console.log(`ok reducer: ${cases.length} goldens conform in node; frozen-input immutability enforced`);
