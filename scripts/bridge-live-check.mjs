import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  readSseJsonFrames,
  spawnBridgeProcess,
  withTimeout,
} from "./bridge-live-support.mjs";

const execFileAsync = promisify(execFile);
const READY_TIMEOUT_MS = 90_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;

async function processRows() {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,command="], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    return match ? [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3],
    }] : [];
  });
}

function descendantsOf(rows, rootPid) {
  const descendants = [];
  const parents = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (parents.has(row.pid) || !parents.has(row.ppid)) continue;
      parents.add(row.pid);
      descendants.push(row);
      changed = true;
    }
  }
  return descendants;
}

function summarizeFrames(frames) {
  return frames.map((frame) => (
    frame.agents?.map((agent) => `${agent.id}:${agent.state}`).join(",") || "invalid"
  )).join(" -> ");
}

async function readReadyState(url, token, frames, intermediateStates) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READY_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/bridge/events`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    assert.equal(response.status, 200, `bridge events returned HTTP ${response.status}`);
    const ready = await readSseJsonFrames(response, (frame) => {
      frames.push(frame);
      assert.deepEqual(
        frame.agents?.map((agent) => agent.id).sort(),
        ["codex"],
        "bridge state must contain Codex"
      );
      for (const agent of frame.agents) {
        assert.ok(
          ["starting", "ready", "error"].includes(agent.state),
          `${agent.id} emitted forbidden intermediate state ${agent.state}`
        );
        if (agent.state === "ready") {
          assert.ok(
            Array.isArray(agent.models) && agent.models.length > 0,
            `${agent.id} reached ready without a non-empty catalog`
          );
          assert.equal(Object.hasOwn(agent, "fix"), false);
        } else if (agent.state === "starting") {
          intermediateStates.add(agent.state);
          assert.equal(
            Object.hasOwn(agent, "fix"),
            false,
            `${agent.id} starting state must not carry a fix`
          );
        }
      }
      return (
        frame.agents.every((agent) => agent.state === "ready")
        || frame.agents.some((agent) => agent.state === "error")
      )
        ? frame
        : undefined;
    });
    if (ready) return ready;
    throw new Error(`bridge event stream closed before ready: ${summarizeFrames(frames)}`);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `bridge did not converge within ${READY_TIMEOUT_MS}ms: ${summarizeFrames(frames)}`
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const bridgeRun = spawnBridgeProcess({
  maxStderrBytes: 64 * 1024,
  earlyExitError: ({ code, signal, stderr }) => new Error(
    `bridge exited before startup (code=${code}, signal=${signal}): ${stderr.trim()}`
  ),
});
const bridgeProcess = bridgeRun.child;
const bridgeExit = bridgeRun.exit;

const frames = [];
const intermediateStates = new Set();
let finalState;
let failure;
try {
  const connection = await withTimeout(
    bridgeRun.startup,
    READY_TIMEOUT_MS,
    "bridge did not print its ephemeral URL and token"
  );
  finalState = await readReadyState(
    connection.url,
    connection.token,
    frames,
    intermediateStates
  );
} catch (error) {
  failure = error;
}

const beforeShutdown = await processRows();
const ownedBeforeShutdown = descendantsOf(beforeShutdown, bridgeProcess.pid);
if (bridgeProcess.exitCode === null && bridgeProcess.signalCode === null) {
  bridgeProcess.kill("SIGTERM");
}
try {
  await withTimeout(
    bridgeExit,
    SHUTDOWN_TIMEOUT_MS,
    `bridge did not exit within ${SHUTDOWN_TIMEOUT_MS}ms`
  );
} catch (error) {
  failure ||= error;
  if (bridgeProcess.exitCode === null && bridgeProcess.signalCode === null) {
    bridgeProcess.kill("SIGKILL");
    await withTimeout(bridgeExit, 5_000, "bridge survived SIGKILL").catch(() => {});
  }
}

await new Promise((resolve) => setTimeout(resolve, 250));
const afterShutdown = await processRows();
const ownedByPid = new Map(ownedBeforeShutdown.map((row) => [row.pid, row.command]));
const survivingDescendants = afterShutdown.filter((row) => (
  ownedByPid.get(row.pid) === row.command
));
const stillParented = afterShutdown.filter((row) => row.ppid === bridgeProcess.pid);
const orphans = new Map(
  [...survivingDescendants, ...stillParented].map((row) => [row.pid, row])
);
for (const row of orphans.values()) {
  try {
    process.kill(row.pid, "SIGTERM");
  } catch {
    // It exited between the parentage check and cleanup.
  }
}
if (orphans.size && !failure) {
  failure = new Error(
    `bridge shutdown left child processes: ${
      [...orphans.values()].map((row) => `${row.pid}:${row.command}`).join(", ")
    }`
  );
}

if (failure) {
  const logs = bridgeRun.stderr().trim()
    .split(/\r?\n/)
    .slice(-20)
    .join("\n")
    .replace(/[a-f0-9]{64}/g, "<redacted>");
  throw new Error(`${failure.message}${logs ? `\nbridge stderr:\n${logs}` : ""}`, {
    cause: failure,
  });
}

const errorFrames = frames.filter((frame) => (
  frame.agents.some((agent) => agent.state === "error")
));
const errorAgents = errorFrames.flatMap((frame) => (
  frame.agents.filter((agent) => agent.state === "error")
));
assert.equal(
  errorFrames.length,
  0,
  `healthy bridge emitted error state: ${errorAgents.map((agent) => (
    `${agent.id} state=${agent.state} fix=${JSON.stringify(agent.fix)}`
  )).join(", ")}`
);
assert.deepEqual([...intermediateStates], ["starting"]);
const finalById = new Map(finalState.agents.map((agent) => [agent.id, agent]));
const codex = finalById.get("codex");
process.stdout.write(
  `acceptance I codex=${codex.state} models=${codex.models.length} `
  + `intermediate=${[...intermediateStates].join(",")} `
  + `error_frames=${errorFrames.length} orphan_count=${orphans.size}\n`
);
