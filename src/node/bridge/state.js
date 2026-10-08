const REFRESH_MS = 15_000;
const STATES = new Set(["starting", "missing", "signed_out", "ready", "error"]);

function assertAgentState(agent) {
  if (!agent || !STATES.has(agent.state)) {
    throw new Error(`Invalid bridge state for ${agent?.id || "unknown agent"}`);
  }
  const ready = agent.state === "ready";
  const hasModels = Array.isArray(agent.models) && agent.models.length > 0;
  if (ready !== hasModels) {
    throw new Error(`Bridge agent ${agent.id} violates ready/models invariant`);
  }
  if (ready || agent.state === "starting") {
    if (Object.hasOwn(agent, "fix")) {
      throw new Error(`${agent.state} bridge agent ${agent.id} must not carry a fix`);
    }
    if (!ready && Object.hasOwn(agent, "models")) {
      throw new Error(`Starting bridge agent ${agent.id} must not carry models`);
    }
  } else if (typeof agent.fix !== "string" || !agent.fix || Object.hasOwn(agent, "models")) {
    throw new Error(`Non-ready bridge agent ${agent.id} must carry exactly one fix and no models`);
  }
  return agent;
}

/** @param {string} id @param {{plan?: string, models: any[]}} input */
export function readyAgent(id, { plan, models }) {
  return assertAgentState({
    id,
    state: "ready",
    ...(plan ? { plan } : {}),
    models: models.map((model) => ({
      id: model.id,
      name: model.name,
      images: model.images,
      reasoning: model.reasoning,
    })),
  });
}

export function startingAgent(id, detail) {
  return assertAgentState({
    id,
    state: "starting",
    ...(detail ? { detail } : {}),
  });
}

export function unavailableAgent(id, state, fix, detail) {
  return assertAgentState({
    id,
    state,
    fix,
    ...(detail ? { detail } : {}),
  });
}

export class BridgeStateStore {
  /** @param {{version: string, backends: any, logger?: any, refreshMs?: number}} input */
  constructor({ version, backends, logger, refreshMs = REFRESH_MS }) {
    this.version = version;
    this.backends = backends;
    this.logger = logger;
    this.refreshMs = refreshMs;
    this.listeners = new Set();
    this.timer = null;
    this.refreshPromise = null;
    this.closed = false;
    this.value = {
      bridge: version,
      agents: [
        backends.claude.initialState(),
        backends.codex.initialState(),
      ].map(assertAgentState),
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  schedule() {
    if (this.closed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.refresh();
    }, this.refreshMs);
    this.timer.unref?.();
  }

  async refresh() {
    if (this.closed) return this.value;
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = Promise.all([
      this.backends.claude.probe(),
      this.backends.codex.probe(),
    ]).then((agents) => {
      const next = {
        bridge: this.version,
        agents: agents.map(assertAgentState),
      };
      if (JSON.stringify(next) !== JSON.stringify(this.value)) {
        this.value = next;
        for (const listener of this.listeners) listener(next);
      }
      return this.value;
    }).catch((error) => {
      this.logger?.warn?.(`Bridge state refresh failed (${error?.code || "turn_failed"})`);
      return this.value;
    }).finally(() => {
      this.refreshPromise = null;
      this.schedule();
    });
    return this.refreshPromise;
  }

  async replaceBackends(backends) {
    clearTimeout(this.timer);
    await this.refreshPromise;
    if (this.closed) return this.value;
    clearTimeout(this.timer);
    this.backends = backends;
    this.value = {
      bridge: this.version,
      agents: [backends.claude.initialState(), backends.codex.initialState()].map(assertAgentState),
    };
    for (const listener of this.listeners) listener(this.value);
    return this.refresh();
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.listeners.clear();
  }
}
