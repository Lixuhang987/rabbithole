import { fork } from "node:child_process";

/** Keep terminal/service ownership stable while HTTP workers reload from disk. */
export async function launchBridge(options) {
  let child;
  let stopping = false;
  let nextOptions = options;
  let resolveExit;
  const exited = new Promise((resolve) => { resolveExit = resolve; });
  const stop = (signal) => {
    stopping = true;
    child?.kill(signal);
  };
  const onInterrupt = () => stop("SIGINT");
  const onTerminate = () => stop("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  function start() {
    let restart = false;
    const worker = fork(new URL("./worker.js", import.meta.url), [], {
      env: options.env || process.env,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });
    child = worker;
    worker.on("message", (value) => {
      const message = /** @type {{type?: string, port?: number}} */ (value);
      if (message?.type === "ready") {
        nextOptions = { ...options, port: message.port, newToken: false, autoOpen: false };
      } else if (message?.type === "restart") {
        restart = true;
      }
    });
    worker.once("error", (error) => {
      process.stderr.write(`rabbithole bridge: ${error.message}\n`);
      resolveExit(1);
    });
    worker.once("exit", (code, signal) => {
      if (restart && code === 0 && !signal && !stopping) start();
      else resolveExit(signal ? 1 : (code ?? 1));
    });
    // Environment is inherited, not serialized through the control channel.
    const { env: _env, ...input } = nextOptions;
    worker.send(input);
  }
  try {
    start();
    process.exitCode = await exited;
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
  }
}
