#!/usr/bin/env node
const [mode, flag, script] = process.argv.slice(2);
if (mode !== "nodejs" || flag !== "-e" || !script) process.exit(2);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
try {
  await new AsyncFunction(script)();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
