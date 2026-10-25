import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reloadScript = `const initial = document.currentScript.dataset.build;
const events = new EventSource('/__dev/events');
events.onmessage = ({data}) => { if (data !== initial) location.reload(); };
`;
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".pfb": "application/octet-stream",
  ".bcmap": "application/octet-stream",
};

/**
 * Keep the bridge independent: this server owns only temporary frontend builds.
 * @param {{rootDir?: string, port?: number, pollInterval?: number, log?: (message: string) => void}} [options]
 */
export async function startDevServer({ rootDir = projectRoot, port = 3000, pollInterval = 300, log = (message) => process.stderr.write(`${message}\n`) } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-dev-"));
  let files = new Map();
  const instance = randomUUID();
  let revision = "";
  let buildNumber = 0;
  let stopped = false;
  let timer;
  let child;
  let building;
  let polling;
  const clients = new Set();
  const server = http.createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
    if (!allowedHosts.has(req.headers.host)) return res.writeHead(403).end("Forbidden host");
    if (req.method !== "GET" && req.method !== "HEAD") return res.writeHead(405, { Allow: "GET, HEAD" }).end();
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      return res.writeHead(400).end("Bad request");
    }
    if (pathname === "/__dev/events" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
      res.write(`data: ${revision}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (pathname === "/__dev/reload.js") {
      res.writeHead(200, { "Content-Type": contentTypes[".js"] });
      return res.end(req.method === "HEAD" ? undefined : reloadScript);
    }
    let name = pathname.slice(1);
    if (!name || (!files.has(name) && !path.posix.extname(name))) name = "index.html";
    let bytes = files.get(name);
    if (!bytes) return res.writeHead(revision ? 404 : 503).end(revision ? "Not found" : "Building frontend");
    if (name === "index.html") {
      bytes = Buffer.from(bytes.toString().replace("</body>", `<script src="/__dev/reload.js" data-build="${revision}"></script></body>`));
    }
    res.writeHead(200, { "Content-Type": contentTypes[path.posix.extname(name)] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : bytes);
  });

  async function build() {
    log("Building frontend…");
    await new Promise((resolve, reject) => {
      child = spawn(process.execPath, ["build.mjs", `--dev-dir=${directory}`], { cwd: rootDir, stdio: ["ignore", "ignore", "pipe"] });
      let errors = "";
      child.stderr.on("data", (chunk) => { errors = (errors + chunk).slice(-64_000); });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        child = null;
        if (code === 0) resolve();
        else reject(new Error(errors || `Build exited with ${signal || code}`));
      });
    });
    if (stopped) return;
    const next = new Map();
    await readAssets(path.join(directory, "web"), "", next);
    // Lazy imports in already-open pages still need chunks from earlier builds.
    for (const [name, bytes] of files) {
      if (name.startsWith("chunks/") && !next.has(name)) next.set(name, bytes);
    }
    files = next;
    revision = `${instance}:${++buildNumber}`;
    for (const client of clients) client.write(`data: ${revision}\n\n`);
    log(`Frontend ready (build ${buildNumber}).`);
  }

  async function close() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    child?.kill("SIGTERM");
    for (const client of clients) client.end();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
    await Promise.allSettled([polling, building]);
    await fs.rm(directory, { recursive: true, force: true });
  }

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve(undefined));
    });
    port = server.address().port;
    let fingerprint = await sourceFingerprint(rootDir);
    building = build();
    await building;
    async function poll() {
      try {
        const next = await sourceFingerprint(rootDir);
        if (stopped) return;
        if (next !== fingerprint) {
          fingerprint = next;
          building = build();
          await building;
        }
      } catch (error) {
        if (!stopped) log(`Build failed; keeping the last successful frontend.\n${error.message}`);
      } finally {
        if (!stopped) timer = setTimeout(() => { polling = poll(); }, pollInterval);
      }
    }
    timer = setTimeout(() => { polling = poll(); }, pollInterval);
    return { url: `http://localhost:${port}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}

async function readAssets(directory, prefix, files) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await readAssets(target, `${name}/`, files);
    else if (entry.isFile()) files.set(name, await fs.readFile(target));
  }
}

async function sourceFingerprint(rootDir) {
  const entries = [];
  async function walk(relative) {
    const target = path.join(rootDir, relative);
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(target)).sort()) await walk(path.join(relative, name));
    } else {
      entries.push([relative, stat.mtimeMs, stat.size]);
    }
  }
  for (const name of ["src/core", "src/ui", "src/web", "src/design", "policy", "build.mjs", "scripts/check-css-integrity.mjs", "package.json"]) await walk(name);
  return JSON.stringify(entries);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const port = args.length === 0 ? 3000 : args.length === 2 && args[0] === "--port" ? Number(args[1]) : NaN;
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Usage: npm run dev -- [--port N]");
    const dev = await startDevServer({ port });
    process.stdout.write(`Rabbithole dev: ${dev.url}\n`);
    process.stderr.write("Frontend edits rebuild and reload the page. Keep the local bridge running for documents and Codex.\n");
    const stop = () => { void dev.close().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  } catch (error) {
    process.stderr.write(`Rabbithole dev: ${error.message}\n`);
    process.exitCode = 1;
  }
}
