/** @protects ui bundle boundaries capability contracts. */
import assert from "node:assert/strict";
import * as esbuild from "esbuild";
import { CANVAS_SHELL } from "../../src/core/html/shell.js";
import { CANVAS_STYLES } from "../support/design-css.mjs";

const result = await esbuild.build({
  entryPoints: ["src/ui/frozen-entry.js"],
  bundle: true,
  write: false,
  metafile: true,
  format: "iife",
  platform: "browser",
  target: "es2018",
  loader: { ".css": "text" },
  logLevel: "silent",
});

const inputs = Object.keys(result.metafile.inputs);
const forbidden = inputs.filter((input) =>
  input.startsWith("src/ui/hosts/live/")
  || input === "src/ui/preference-host-backing.js"
  || input.startsWith("src/web/")
);

assert.deepEqual(
  forbidden,
  [],
  `frozen UI must not reach live host modules or browser persistence:\n${forbidden.join("\n")}`,
);

const liveResult = await esbuild.build({
  entryPoints: ["src/ui/entry.js"],
  bundle: true,
  write: false,
  metafile: true,
  format: "iife",
  platform: "browser",
  target: "es2018",
  loader: { ".css": "text" },
  logLevel: "silent",
});
for (const liveMaintenanceModule of ["src/ui/canvas/attention.js", "src/ui/canvas/auto-tidy.js"]) {
  const importers = Object.entries(liveResult.metafile.inputs)
    .filter(([, input]) => input.imports.some((dependency) => dependency.path === liveMaintenanceModule))
    .map(([input]) => input)
    .sort();
  assert.deepEqual(
    importers,
    ["src/ui/hosts/live/index.js"],
    "only the live-host composition may own " + liveMaintenanceModule,
  );
  assert.equal(inputs.includes(liveMaintenanceModule), false, "frozen UI must exclude " + liveMaintenanceModule);
}

const frozenBundle = result.outputFiles[0].text;
for (const liveOnlyText of [
  "attention",
  "auto-tidy: false fold",
  "rh-auto-tidy",
  "Folds branches you've moved on from",
  "data-tidy-enabled",
]) {
  assert.doesNotMatch(frozenBundle, new RegExp(liveOnlyText), `frozen UI must exclude live maintenance: ${liveOnlyText}`);
}
assert.doesNotMatch(frozenBundle, /preferences_patch/, "frozen UI must exclude the machine preference writer");
const removedActivityUi = `${CANVAS_SHELL}\n${CANVAS_STYLES}\n${frozenBundle}`;
for (const pattern of [
  /id=["']since["']/,
  /while you were away/i,
  /si-new/,
  /pal-dot/,
  /node\.unread/,
  /isUnread/,
  /markRead/,
  /unreadNodes/,
]) {
  assert.doesNotMatch(removedActivityUi, pattern, `removed activity UI must stay absent: ${pattern}`);
}

// The world layer must never be permanently promoted: the compositor then
// bitmap-scales stale text rasters on zoom instead of repainting, so existing
// cards blur while freshly painted ones stay sharp.
const worldRule = CANVAS_STYLES.match(/#world\s*\{[^}]*\}/)?.[0] ?? "";
assert.ok(worldRule, "expected a #world rule in canvas styles");
assert.doesNotMatch(worldRule, /will-change/, "#world must not carry will-change (stale-raster blur on zoom)");

console.log("ok UI bundle boundaries: frozen client excludes live host modules and removed activity messaging");
