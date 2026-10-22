import { runBridge } from "./main.js";

let bridge;
let stopping = false;
async function stop(restarting = false) {
  if (stopping) return;
  stopping = true;
  try {
    if (restarting && process.connected) process.send({ type: "restart" });
    await bridge?.close();
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`rabbithole bridge: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
  }
}
process.once("disconnect", () => { void stop(); });
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });
process.once("message", async (value) => {
  try {
    const options = /** @type {Parameters<typeof runBridge>[0]} */ (value);
    bridge = await runBridge({ ...options, onRestart: () => { void stop(true); } });
    if (stopping) await bridge.close();
    else if (process.connected) process.send({ type: "ready", port: bridge.port });
  } catch (error) {
    stopping = true;
    process.stderr.write(`rabbithole bridge: ${error.message}\n`);
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
});
