/**
 * Owns the lifetime of the subscription bridge event stream and availability
 * probe. Rendering is deliberately outside this module; callers receive state
 * transitions through the small callback port below.
 *
 * @param {{
 *   loadSettings: () => any,
 *   isConfigured: (settings: any) => boolean,
 *   consumeEvents: (baseUrl: string, token: string, options: any) => Promise<{reason?: string}>,
 *   ping: (baseUrl: string) => Promise<boolean>,
 *   nextDelay: (delay: number) => number,
 *   pingInterval: number,
 *   probeWanted: () => boolean,
 *   reconnectFromProbe?: () => boolean,
 *   onState: (state: any) => void,
 *   onView: (view: string) => void,
 *   onDisconnected: () => void,
 *   onUnauthorized: () => void,
 *   onProbeChange: (up: boolean) => void,
 *   documentRef?: {hidden: boolean, addEventListener: (type: string, listener: () => void) => void, removeEventListener: (type: string, listener: () => void) => void},
 *   setTimeoutFn?: (callback: () => void, delay?: number) => any,
 *   clearTimeoutFn?: (timer: any) => void,
 *   queueMicrotaskFn?: (callback: () => void) => void,
 * }} options
 */
export function createBridgeConnection(options) {
  const documentRef = options.documentRef || document;
  const setTimeoutFn = options.setTimeoutFn || setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
  const queueMicrotaskFn = options.queueMicrotaskFn || queueMicrotask;

  let stream = null;
  let streamKey = "";
  /** @type {ReturnType<typeof setTimeout> | 0} */ let reconnectTimer = 0;
  let reconnectDelay = 0;
  let reconnectPending = false;
  let immediateReconnectAvailable = true;
  let probeUp = false;
  /** @type {ReturnType<typeof setTimeout> | 0} */ let probeTimer = 0;
  let probeGeneration = 0;
  let probeInFlight = false;

  function stopStream() {
    documentRef.removeEventListener("visibilitychange", handleVisibilityChange);
    clearTimeoutFn(reconnectTimer);
    reconnectTimer = 0;
    reconnectDelay = 0;
    reconnectPending = false;
    immediateReconnectAvailable = true;
    stream?.abort();
    stream = null;
    streamKey = "";
  }

  function stopProbe() {
    probeGeneration += 1;
    clearTimeoutFn(probeTimer);
    probeTimer = 0;
    probeInFlight = false;
    if (probeUp) {
      probeUp = false;
      options.onProbeChange(false);
    }
  }

  function scheduleProbe(delay) {
    clearTimeoutFn(probeTimer);
    probeTimer = setTimeoutFn(() => {
      probeTimer = 0;
      void runProbe();
    }, delay);
  }

  async function runProbe() {
    if (!options.probeWanted()) return;
    if (documentRef.hidden) {
      scheduleProbe(options.pingInterval);
      return;
    }
    const generation = probeGeneration;
    probeInFlight = true;
    const up = await options.ping(options.loadSettings().base_url);
    probeInFlight = false;
    if (generation !== probeGeneration || !options.probeWanted()) return;
    if (up !== probeUp) {
      probeUp = up;
      options.onProbeChange(up);
      if (up && options.reconnectFromProbe?.() && streamKey) requestReconnect(streamKey, 0);
    }
    scheduleProbe(options.pingInterval);
  }

  function syncProbe() {
    if (!options.probeWanted()) {
      stopProbe();
      return;
    }
    if (!probeTimer && !probeInFlight) scheduleProbe(0);
  }

  function handleVisibilityChange() {
    if (documentRef.hidden) {
      if (reconnectTimer) {
        clearTimeoutFn(reconnectTimer);
        reconnectTimer = 0;
        reconnectPending = true;
      }
      return;
    }
    if (!reconnectPending || stream || !streamKey) return;
    reconnectPending = false;
    connect(streamKey);
  }

  function requestReconnect(connectionKey, delay) {
    if (streamKey !== connectionKey) return;
    reconnectPending = true;
    if (documentRef.hidden) return;
    if (delay === 0) {
      queueMicrotaskFn(() => {
        if (!reconnectPending || stream || streamKey !== connectionKey || documentRef.hidden) return;
        reconnectPending = false;
        connect(connectionKey);
      });
      return;
    }
    reconnectTimer = setTimeoutFn(() => {
      reconnectTimer = 0;
      if (!reconnectPending || stream || streamKey !== connectionKey || documentRef.hidden) return;
      reconnectPending = false;
      connect(connectionKey);
    }, delay);
  }

  function streamEnded(connectionKey, reason = "closed") {
    if (streamKey !== connectionKey) return;
    options.onDisconnected();
    if (reason === "unauthorized") {
      stopStream();
      options.onUnauthorized();
      options.onView("re_pair");
      return;
    }
    options.onView("bridge_down");
    if (immediateReconnectAvailable) {
      immediateReconnectAvailable = false;
      requestReconnect(connectionKey, 0);
      return;
    }
    reconnectDelay = options.nextDelay(reconnectDelay);
    requestReconnect(connectionKey, reconnectDelay);
  }

  function connect(connectionKey) {
    if (stream || streamKey !== connectionKey) return;
    const settings = options.loadSettings();
    const token = String(settings.token || "").trim();
    if (!options.isConfigured(settings) || `${settings.base_url}\n${token}` !== connectionKey) {
      stopStream();
      return;
    }
    const controller = new AbortController();
    stream = controller;
    void options.consumeEvents(settings.base_url, token, {
      signal: controller.signal,
      onState: (state) => {
        if (stream !== controller || controller.signal.aborted) return;
        reconnectDelay = 0;
        immediateReconnectAvailable = true;
        options.onState(state);
      },
    }).then((result) => {
      if (stream !== controller || controller.signal.aborted) return;
      stream = null;
      streamEnded(connectionKey, result.reason);
    }).catch((error) => {
      if (stream !== controller || controller.signal.aborted || error?.name === "AbortError") return;
      stream = null;
      streamEnded(connectionKey);
    });
  }

  function start() {
    const settings = options.loadSettings();
    if (!options.isConfigured(settings)) {
      stopStream();
      return;
    }
    const token = String(settings.token || "").trim();
    if (!token) {
      stopStream();
      options.onView("re_pair");
      return;
    }
    const connectionKey = `${settings.base_url}\n${token}`;
    if (streamKey === connectionKey) return;
    stopStream();
    streamKey = connectionKey;
    documentRef.addEventListener("visibilitychange", handleVisibilityChange);
    options.onView("starting");
    connect(connectionKey);
  }

  return Object.freeze({
    start,
    stopStream,
    stopProbe,
    syncProbe,
    dispose() {
      stopStream();
      stopProbe();
    },
    snapshot: () => Object.freeze({
      connected: !!stream,
      streamKey,
      reconnectDelay,
      reconnectPending,
      immediateReconnectAvailable,
      probeUp,
      probeGeneration,
      probeInFlight,
    }),
  });
}
