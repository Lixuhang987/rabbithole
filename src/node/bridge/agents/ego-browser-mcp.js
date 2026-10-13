import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { callEgoBrowser } from "./ego-browser.js";

const [executable, skillPath] = process.argv.slice(2);
if (!executable || !skillPath) throw new Error("An ego-browser executable and skill path are required.");
const browser = { executable, skillPath: await fs.realpath(skillPath) };
const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-ego-")));
const controller = new AbortController();
const calls = new Set();
const server = new McpServer({ name: "rabbithole_ego_browser", version: "1.0.0" });
server.registerTool("ego_browser", {
  description: "Use the ego-browser skill: run JavaScript through Ego's embedded Node runtime, read a skill reference, or inspect a screenshot. This tool runs locally with the user's browser access.",
  inputSchema: {
    action: z.enum(["run", "read_reference", "view_image"]),
    script: z.string().max(64 * 1024).optional().describe("JavaScript for action=run; not a shell command."),
    path: z.string().optional().describe("For read_reference: relative to the skill directory. For view_image: a screenshot saved in process.cwd()."),
  },
}, async (args, extra) => {
  const cancellation = new AbortController();
  const abort = () => cancellation.abort();
  controller.signal.addEventListener("abort", abort, { once: true });
  extra.signal.addEventListener("abort", abort, { once: true });
  if (controller.signal.aborted || extra.signal.aborted) abort();
  const call = callEgoBrowser(browser, args, { cwd, signal: cancellation.signal });
  calls.add(call);
  try { return await call; } catch (error) {
    return { content: [{ type: "text", text: error.message }], isError: true };
  } finally {
    calls.delete(call);
    controller.signal.removeEventListener("abort", abort);
    extra.signal.removeEventListener("abort", abort);
  }
});

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  controller.abort();
  await Promise.allSettled([...calls]);
  await fs.rm(cwd, { recursive: true, force: true });
  process.exit(0);
}
server.server.onclose = shutdown;
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
await server.connect(new StdioServerTransport());
