import { spawn } from "node:child_process";

import { log, error as logError, warn } from "../shared/logger.js";
import { createBridge } from "./server.js";

const BRIDGE_VERSION = "0.4.0";
const DEFAULT_PORT = 41414;

export { createBridge } from "./server.js";

export function pairingUrl(token, port = DEFAULT_PORT) {
  const portParam = port === DEFAULT_PORT ? "" : `&bridge_port=${port}`;
  return `https://rabbithole.ing/#bridge=${token}${portParam}`;
}

function openInBrowser(url) {
  const [command, args] = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/* The startup print is the one screen every user of this feature reads; stderr
   keeps the parseable log lines, stdout gets the human ones. */
function printBanner({ url, pairUrl, opened, out = process.stdout }) {
  const tty = out.isTTY;
  const bold = (text) => (tty ? `\u001B[1m${text}\u001B[0m` : text);
  const dim = (text) => (tty ? `\u001B[2m${text}\u001B[0m` : text);
  out.write(`\n  ${bold("Rabbithole bridge")} ${dim(`· ${url}`)}\n`
    + `  ${dim("Answers on rabbithole.ing come from Codex on this computer.")}\n\n`
    + `  ${bold("→")} Open this link to connect your browser:\n\n`
    + `    ${bold(pairUrl)}\n`
    + (opened ? `\n    ${dim("Opening it for you…")}\n` : "")
    + `\n  ${dim("Keep this running while you use Rabbithole. Ctrl-C stops it.")}\n\n`);
}

/** @param {{port?: number, newToken?: boolean, autoOpen?: boolean, env?: NodeJS.ProcessEnv, onRestart?: () => void}} [options] */
export async function runBridge({
  port = DEFAULT_PORT,
  newToken = false,
  autoOpen = true,
  env = process.env,
  onRestart,
} = {}) {
  const bridge = await createBridge({
    port,
    newToken,
    env,
    version: BRIDGE_VERSION,
    logger: { warn },
    onRestart,
  });
  await bridge.start();
  const pairUrl = pairingUrl(bridge.token, bridge.port);
  // First run (or --new-token) means no browser is paired yet — opening the
  // link is the setup, so do it for the user. Reruns stay quiet: the browser
  // already holds the token and reconnects on its own.
  const opened = autoOpen && bridge.tokenCreated && process.stdout.isTTY && openInBrowser(pairUrl);
  printBanner({ url: bridge.url, pairUrl, opened });
  // These two lines duplicate the banner for machine consumers (test harnesses,
  // process-manager logs), which capture stderr through pipes — never a TTY. A
  // human's terminal is one, so they see the banner alone.
  if (!process.stderr.isTTY) {
    log(`Rabbithole bridge listening on ${bridge.url} (pid ${process.pid})`);
    log(`Pairing token: ${bridge.token}`);
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${signal}, shutting down bridge`);
    try {
      await bridge.close();
      process.exitCode = 0;
    } catch (error) {
      logError(`Bridge shutdown failed: ${error.message}`);
      process.exitCode = 1;
    }
  };
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      shutdown(signal);
    });
  }
  return bridge;
}
