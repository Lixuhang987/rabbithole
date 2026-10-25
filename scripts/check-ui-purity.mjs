import fs from "node:fs/promises";
import path from "node:path";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = path.join(rootDir, "src/ui");
const coreDir = path.join(rootDir, "src/core");
const nodeDir = path.join(rootDir, "src/node");
const webDir = path.join(rootDir, "src/web");
const designDir = path.join(rootDir, "src/design");
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const failures = [];

for (const file of await listJs(uiDir)) {
  await checkUiFile(file);
}
for (const file of await listJs(coreDir)) {
  await checkCoreFile(file);
}
for (const file of await listJs(nodeDir)) {
  await checkHostFile(file, nodeDir, webDir, "node", "web");
}
for (const file of await listJs(webDir)) {
  await checkWebFile(file);
}
await checkNodeOwnership();

if (failures.length) {
  process.stderr.write(`purity check failed:\n${failures.join("\n")}\n`);
  process.exit(1);
}

async function checkUiFile(file) {
  const source = await fs.readFile(file, "utf8");
  for (const specifier of importSpecifiers(source)) {
    if (builtins.has(specifier)) {
      failures.push(`${rel(file)} imports Node builtin ${specifier}`);
      continue;
    }
    if (specifier.startsWith(".")) {
      const resolved = resolveImport(file, specifier);
      const relToUi = path.relative(uiDir, resolved);
      const relToCore = path.relative(coreDir, resolved);
      const relToDesign = path.relative(designDir, resolved);
      if (!isInside(relToUi) && !isInside(relToCore) && !isInside(relToDesign)) {
        failures.push(`${rel(file)} reaches outside src/ui or src/core via ${specifier}`);
      }
      continue;
    }
    failures.push(`${rel(file)} imports non-UI package ${specifier}`);
  }
}

async function checkCoreFile(file) {
  const source = await fs.readFile(file, "utf8");
  for (const specifier of importSpecifiers(source)) {
    if (builtins.has(specifier)) {
      failures.push(`${rel(file)} imports Node builtin ${specifier}`);
      continue;
    }
    if (!specifier.startsWith(".")) continue;
    const resolved = resolveImport(file, specifier);
    const relToCore = path.relative(coreDir, resolved);
    const relToNode = path.relative(nodeDir, resolved);
    const relToUi = path.relative(uiDir, resolved);
    if (relToNode && !relToNode.startsWith("..") && !path.isAbsolute(relToNode)) {
      failures.push(`${rel(file)} imports src/node via ${specifier}`);
    }
    if (relToUi && !relToUi.startsWith("..") && !path.isAbsolute(relToUi)) {
      failures.push(`${rel(file)} imports src/ui via ${specifier}`);
    }
    if (relToCore.startsWith("..") || path.isAbsolute(relToCore)) {
      failures.push(`${rel(file)} reaches outside src/core via ${specifier}`);
    }
  }
}

async function checkHostFile(file, ownDir, forbiddenDir, ownName, forbiddenName) {
  const source = await fs.readFile(file, "utf8");
  for (const specifier of importSpecifiers(source)) {
    if (!specifier.startsWith(".")) continue;
    const resolved = resolveImport(file, specifier);
    const relToOwn = path.relative(ownDir, resolved);
    const relToCore = path.relative(coreDir, resolved);
    const relToForbidden = path.relative(forbiddenDir, resolved);
    if (isInside(relToForbidden)) {
      failures.push(`${rel(file)} imports src/${forbiddenName} via ${specifier}`);
    }
    if (!isInside(relToOwn) && !isInside(relToCore)) {
      failures.push(`${rel(file)} reaches outside src/${ownName} or src/core via ${specifier}`);
    }
  }
}

async function checkNodeOwnership() {
  const files = await listJs(nodeDir);
  const sources = await Promise.all(files.map(async (file) => ({ file, source: await fs.readFile(file, "utf8") })));
  for (const { file, source } of sources) {
    if (!file.endsWith("shared/deadline.js") && /\b300_?000\b/.test(source)) {
      failures.push(`${rel(file)} declares the shared 300-second agent budget again`);
    }
  }
  const joined = sources.map(({ source }) => source).join("\n");
  for (const [label, pattern] of [
    ["probeAgent", /\b(?:async\s+)?function\s+probeAgent\b/g],
    ["NDJSON reader", /\bfunction\s+createNdjsonReader\b/g],
  ]) {
    const count = joined.match(pattern)?.length || 0;
    if (count !== 1) failures.push(`src/node must define ${label} exactly once (found ${count})`);
  }
  const settingsSource = await fs.readFile(path.join(webDir, "settings/model-settings.js"), "utf8");
  for (const name of ["bridgeStream", "bridgeStreamKey", "bridgeReconnectTimer", "bridgeReconnectDelay", "bridgeReconnectPending", "bridgeImmediateReconnectAvailable", "bridgeProbeTimer", "bridgeProbeGeneration", "bridgeProbeInFlight"]) {
    if (new RegExp(`\\blet\\s+${name}\\b`).test(settingsSource)) failures.push(`src/web/settings/model-settings.js owns ${name}; bridge-connection.js must own it`);
  }
}

async function checkWebFile(file) {
  const source = await fs.readFile(file, "utf8");
  for (const specifier of importSpecifiers(source)) {
    if (builtins.has(specifier)) {
      failures.push(`${rel(file)} imports Node builtin ${specifier}`);
      continue;
    }
    if (!specifier.startsWith(".")) continue;
    const resolved = resolveImport(file, specifier);
    const relToWeb = path.relative(webDir, resolved);
    const relToUi = path.relative(uiDir, resolved);
    const relToCore = path.relative(coreDir, resolved);
    const relToNode = path.relative(nodeDir, resolved);
    if (isInside(relToNode)) failures.push(`${rel(file)} imports src/node via ${specifier}`);
    if (!isInside(relToWeb) && !isInside(relToUi) && !isInside(relToCore)) {
      failures.push(`${rel(file)} reaches outside src/web, src/ui, or src/core via ${specifier}`);
    }
  }
}

function isInside(relativePath) {
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function listJs(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listJs(file));
    else if (entry.isFile() && entry.name.endsWith(".js")) out.push(file);
  }
  return out.sort();
}

function importSpecifiers(source) {
  const out = [];
  const re = /\bimport\s+(?:[^'";]+?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = re.exec(source))) out.push(match[1] || match[2]);
  return out;
}

function resolveImport(file, specifier) {
  const resolved = path.resolve(path.dirname(file), specifier);
  return path.extname(resolved) ? resolved : `${resolved}.js`;
}

function rel(file) {
  return path.relative(rootDir, file);
}
