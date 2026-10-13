/** @protects install smoke capability contracts. */
/**
 * Pack/install/launch release smoke test.
 *
 * Kept out of `npm test`: it creates and installs a real npm artifact, so it is
 * slower and more sensitive to the local npm cache/network than the default
 * deterministic suite. CI runs it separately on every supported Node version.
 */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TIMEOUT_MS = 15_000;

async function filesBelow(relativeDir) {
  const absoluteDir = path.join(ROOT, relativeDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...(await filesBelow(relativePath)));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

function withTimeout(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForBridge(child) {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const details = await withTimeout(
    new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => reject(new Error(
        `bridge exited before listening (code=${code}, signal=${signal}, stderr=${stderr})`
      )));
      child.stderr.on("data", () => {
        const portMatch = /Rabbithole bridge listening on http:\/\/127\.0\.0\.1:(\d+)/.exec(stderr);
        const tokenMatch = /Pairing token: ([a-f0-9]{64})/.exec(stderr);
        if (portMatch && tokenMatch) {
          resolve({ port: Number(portMatch[1]), token: tokenMatch[1] });
        }
      });
    }),
    "bridge listen"
  );
  return { ...details, stdout: () => stdout, stderr: () => stderr };
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-packaging-"));
let child;
try {
  const packDir = path.join(temporaryRoot, "pack");
  const projectDir = path.join(temporaryRoot, "project");
  const dataDir = path.join(temporaryRoot, "data");
  await Promise.all([
    fs.mkdir(packDir),
    fs.mkdir(projectDir),
    fs.mkdir(dataDir),
  ]);

  const { stdout: packOutput } = await execFileAsync(
    "npm",
    ["pack", "--json", "--pack-destination", packDir],
    { cwd: ROOT, maxBuffer: 10 * 1024 * 1024 }
  );
  const [packResult] = JSON.parse(packOutput);
  assert.ok(packResult?.filename, "npm pack did not report a tarball");
  const packedPaths = new Set(packResult.files.map((entry) => entry.path));
  const permittedPathPatterns = [
    /^bin\//,
    /^dist\//,
    /^src\//,
    /^README\.md$/,
    /^LICENSE$/,
    /^THIRD_PARTY_NOTICES\.md$/,
    /^package\.json$/,
  ];
  const unexpectedPaths = [...packedPaths].filter((packedPath) =>
    !permittedPathPatterns.some((pattern) => pattern.test(packedPath))
  );
  assert.deepEqual(unexpectedPaths, [], `tarball contains unexpected paths:\n${unexpectedPaths.join("\n")}`);
  const requiredPaths = [
    "package.json",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "bin/rabbithole.js",
    ...(await filesBelow("src/node")),
    ...(await filesBelow("src/core")),
    ...(await filesBelow("dist")),
  ];
  for (const requiredPath of requiredPaths) {
    assert.ok(packedPaths.has(requiredPath), `tarball is missing ${requiredPath}`);
  }

  await fs.writeFile(
    path.join(projectDir, "package.json"),
    `${JSON.stringify({ name: "rabbithole-packaging-smoke", private: true }, null, 2)}\n`
  );
  const tarball = path.join(packDir, packResult.filename);
  await execFileAsync(
    "npm",
    ["install", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund", tarball],
    { cwd: projectDir, maxBuffer: 10 * 1024 * 1024 }
  );

  const bridgeBinPath = path.join(projectDir, "node_modules", ".bin", "rabbithole");
  await fs.access(bridgeBinPath, fs.constants.X_OK);
  const unknownResult = await execFileAsync(bridgeBinPath, ["unknown"], {
    cwd: projectDir,
  }).catch((error) => error);
  assert.equal(unknownResult.code, 1, "an unknown rabbithole subcommand must fail");
  assert.equal(unknownResult.stdout, "", "usage must not be written to stdout");
  assert.match(unknownResult.stderr, /^Usage: rabbithole /);

  child = spawn(bridgeBinPath, ["bridge", "--port", "0", "--no-open"], {
    cwd: projectDir, env: { ...process.env, RABBITHOLE_DIR: dataDir,
      RABBITHOLE_BRIDGE_CODEX_BIN: path.join(ROOT, "test/integration/fixtures/fake-codex.mjs"), RABBITHOLE_BRIDGE_EGO_BIN: "/absent/ego" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const bridgeOutput = await waitForBridge(child);
  const modelsResponse = await withTimeout(
    fetch(`http://127.0.0.1:${bridgeOutput.port}/bridge/models`, {
      headers: { Authorization: `Bearer ${bridgeOutput.token}` },
    }),
    "installed bridge models"
  );
  assert.equal(modelsResponse.status, 200);
  const modelList = await modelsResponse.json();
  assert.ok(modelList.models.some((model) => model.id === "gpt-fake"));
  assert.match(bridgeOutput.stdout(), /Open this link to connect your browser/, "bridge stdout must lead with the pairing instruction");
  assert.match(
    bridgeOutput.stdout(),
    new RegExp(`https://rabbithole\\.ing/#bridge=${bridgeOutput.token}&bridge_port=${bridgeOutput.port}`),
    "the printed pairing link must carry the token and non-default port",
  );
  assert.doesNotMatch(bridgeOutput.stdout(), /\u001B\[/, "a non-TTY bridge run must print no ANSI escapes");

  child.kill("SIGTERM");
  const bridgeExit = await withTimeout(waitForExit(child), "clean bridge shutdown");
  assert.deepEqual(bridgeExit, { code: 0, signal: null });
  assert.match(bridgeOutput.stderr(), /Received SIGTERM, shutting down bridge/);
  child = undefined;

  console.log(`ok packaging: asserted ${requiredPaths.length} paths, checked CLI usage and authenticated native model discovery`);
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await withTimeout(waitForExit(child), "forced server shutdown").catch(() => child.kill("SIGKILL"));
  }
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
