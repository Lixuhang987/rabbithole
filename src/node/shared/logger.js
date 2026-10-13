/** Stderr-only logger. CLI stdout carries the pairing banner. */
import { inspect } from "node:util";

const PREFIX = "[rabbithole";

function formatArg(arg) {
  if (typeof arg === "string") return arg;
  return inspect(arg, { depth: 4, colors: false });
}

function write(level, args) {
  const ts = new Date().toISOString();
  const parts = args.map(formatArg).join(" ");
  const tag = level ? ` ${level}` : "";
  process.stderr.write(`${PREFIX} ${ts}]${tag} ${parts}\n`);
}

export function log(...args) { write("", args); }
export function warn(...args) { write("WARN", args); }
export function error(...args) { write("ERROR", args); }
