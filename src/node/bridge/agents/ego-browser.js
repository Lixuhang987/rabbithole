import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { resolveExecutable, terminateChild } from "./isolation.js";

const OUTPUT_LIMIT = 1024 * 1024;
const FILE_LIMIT = 8 * 1024 * 1024;

/** Discover just the user-installed ego-browser skill; never scan other skills. */
export async function discoverEgoBrowser(env) {
  const executable = resolveExecutable("ego-browser", env.RABBITHOLE_BRIDGE_EGO_BIN, env);
  if (!executable) {
    if (env.RABBITHOLE_BRIDGE_EGO_BIN || env.RABBITHOLE_BRIDGE_EGO_SKILL) {
      throw new Error("The configured ego-browser executable is unavailable.");
    }
    return null;
  }
  const candidates = env.RABBITHOLE_BRIDGE_EGO_SKILL
    ? [env.RABBITHOLE_BRIDGE_EGO_SKILL]
    : [".agents", ".codex"].map((directory) => path.join(env.HOME || "", directory, "skills/ego-browser/SKILL.md"));
  for (const candidate of candidates) {
    let skillPath;
    try { skillPath = await fs.realpath(candidate); } catch (error) {
      if (error.code === "ENOENT" && !env.RABBITHOLE_BRIDGE_EGO_SKILL) continue;
      throw error;
    }
    const instructions = await readBoundedFile(skillPath, 128 * 1024).then((data) => data.toString("utf8"));
    const metadata = instructions.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || "";
    if (!/^name:\s*["']?ego-browser["']?\s*$/m.test(metadata)) {
      throw new Error("Only the ego-browser skill can be exposed by the bridge.");
    }
    return { executable, skillPath, instructions };
  }
  return null;
}

export function egoBrowserInstructions(browser) {
  if (!browser) return "";
  return `\n\n## Available skill: ego-browser\nSource: ${browser.skillPath}\n\n${browser.instructions}

## Rabbithole browser tool adapter
The ego-browser skill is the only available skill. When external information is needed, use web search first. Use ego-browser only when web search is unavailable, fails, or cannot retrieve the required content. This order takes precedence over any browser-first preference in the ego-browser skill. Follow its browser workflow when this fallback is needed.
Use the MCP ego_browser tool on server ${browser.serverName} for all skill operations:
- action=run, script=<JavaScript> runs the equivalent of ego-browser nodejs -e <script>. Pass JavaScript directly, without a shell command or heredoc. The script uses Ego's embedded Node runtime and its documented browser APIs.
- action=read_reference, path=<relative path> reads supporting files within this skill's directory, including references/api.md and references/install.md.
- action=view_image, path=<screenshot path> returns an image for visual inspection. Save screenshots in process.cwd(); this tool's temporary directory persists across rounds of the thread.
Follow the skill's one TaskSpace per user goal, user-control and finish rules. Retain its spaceId across tool calls. No shell or other installed skills are available.\n`;
}

/** @param {string} file @param {number} limit */
async function readBoundedFile(file, limit) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > limit) throw new Error("The requested file is too large or is not a regular file.");
  return fs.readFile(file);
}

async function fileInside(root, requested) {
  if (typeof requested !== "string" || !requested) throw new Error("A file path is required.");
  const file = await fs.realpath(path.resolve(root, requested));
  const relative = path.relative(root, file);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("The requested file is outside the tool's allowed directory.");
  }
  return file;
}

/** @param {{executable: string, env?: NodeJS.ProcessEnv, cwd: string, script: string, signal?: AbortSignal}} options */
function runScript({ executable, env = process.env, cwd, script, signal }) {
  if (typeof script !== "string" || !script.trim() || Buffer.byteLength(script) > 64 * 1024) {
    throw new Error("A JavaScript script of at most 64 KiB is required.");
  }
  if (signal?.aborted) throw new Error("The browser call was cancelled.");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["nodejs", "-e", script], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let size = 0;
    let failure;
    const stop = (message) => { failure ||= new Error(message); terminateChild(child); };
    const onAbort = () => stop("The browser call was cancelled.");
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timer = setTimeout(() => stop("The browser call exceeded 60 seconds."), 60_000);
    const capture = (chunk, isStderr) => {
      size += Buffer.byteLength(chunk);
      if (size > OUTPUT_LIMIT) { stop("Browser output exceeded 1 MiB. Extract a smaller result."); return; }
      if (isStderr) stderr += chunk;
      else stdout += chunk;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => capture(chunk, false));
    child.stderr.on("data", (chunk) => capture(chunk, true));
    child.once("error", (error) => { failure = error; });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (failure) { reject(failure); return; }
      resolve({ content: [{ type: /** @type {const} */ ("text"), text: [stdout, stderr].filter(Boolean).join("\n") || `Ego script exited with code ${code}.` }], ...(code === 0 ? {} : { isError: true }) });
    });
  });
}

/** Execute the single tool's browser, skill-reference, and screenshot operations. */
export async function callEgoBrowser(browser, args, { cwd, signal }) {
  if (args.action === "run") return runScript({ executable: browser.executable, cwd, script: args.script, signal });
  if (args.action === "read_reference") {
    const file = await fileInside(path.dirname(browser.skillPath), args.path);
    const text = (await readBoundedFile(file, OUTPUT_LIMIT)).toString("utf8");
    return { content: [{ type: /** @type {const} */ ("text"), text }] };
  }
  if (args.action === "view_image") {
    const file = await fileInside(cwd, args.path);
    const data = await readBoundedFile(file, FILE_LIMIT);
    const mimeType = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? "image/png" : data[0] === 255 && data[1] === 216 && data[2] === 255 ? "image/jpeg" : null;
    if (!mimeType) throw new Error("Screenshot images must be PNG or JPEG.");
    return { content: [{ type: /** @type {const} */ ("image"), mimeType, data: data.toString("base64") }] };
  }
  throw new Error("Unknown ego-browser tool action.");
}
