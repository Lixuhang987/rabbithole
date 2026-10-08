/** Browser mock of the external bridge stream and native search lifecycle. */
const BRIDGE_EVENTS_URL = "http://127.0.0.1:41414/bridge/events";
const BRIDGE_CHAT_URL = "http://127.0.0.1:41414/v1/chat/completions";
const BRIDGE_PING_URL = "http://127.0.0.1:41414/bridge/ping";

export async function installBridgeFetchStub(context) {
  await context.addInitScript(({ eventsUrl, chatUrl, pingUrl, restartUrl }) => {
    const realFetch = window.fetch.bind(window);
    const encoder = new TextEncoder();
    const streams = new Set();
    const requests = [];
    const chatQueue = [];
    const restartQueue = [];
    let denyNextConnection = false;
    let online = true;
    let pingUp = false;
    let currentState = null;
    let finishSearch = null;
    let hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    function authorization(options) {
      return new Headers(options?.headers || {}).get("Authorization") || "";
    }
    function push(state) {
      currentState = state;
      const bytes = encoder.encode(`data: ${JSON.stringify(state)}\n\n`);
      for (const stream of [...streams]) {
        try { stream.enqueue(bytes); } catch { streams.delete(stream); }
      }
    }
    function closeStreams() {
      for (const stream of [...streams]) {
        streams.delete(stream);
        try { stream.close(); } catch {}
      }
    }
    window.__bridgeStub = {
      requests,
      push,
      close: closeStreams,
      kill() {
        online = false;
        closeStreams();
      },
      restart(state) {
        online = true;
        currentState = state;
      },
      setHidden(value) {
        hidden = Boolean(value);
        document.dispatchEvent(new Event("visibilitychange"));
      },
      denyNextConnection() { denyNextConnection = true; },
      queueChat(...items) { chatQueue.push(...items); },
      queueRestart(...items) { restartQueue.push(...items); },
      finishSearch() { finishSearch?.(); },
      setPing(value) { pingUp = Boolean(value); },
    };
    window.fetch = async (input, options = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === pingUrl) {
        requests.push({ kind: "ping", at: performance.now() });
        if (!pingUp) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === eventsUrl) {
        requests.push({ kind: "events", url, authorization: authorization(options), at: performance.now() });
        if (!online) throw new TypeError("Failed to fetch");
        if (denyNextConnection) {
          denyNextConnection = false;
          return new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(new ReadableStream({
          start(controller) {
            streams.add(controller);
            if (currentState) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(currentState)}\n\n`));
            }
            options.signal?.addEventListener("abort", () => {
              streams.delete(controller);
              try { controller.error(new DOMException("Aborted", "AbortError")); } catch {}
            }, { once: true });
          },
          cancel() {},
        }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }
      if (url === restartUrl) {
        requests.push({ kind: "restart", authorization: authorization(options), method: options.method });
        const result = restartQueue.shift() || {};
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (result.error) return new Response(JSON.stringify({ error: { message: result.error } }), { status: 409, headers: { "Content-Type": "application/json" } });
        push(currentState);
        return new Response(JSON.stringify({ ok: true, state: currentState }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === chatUrl) {
        const body = JSON.parse(typeof options.body === "string" ? options.body : "{}");
        requests.push({ kind: "chat", authorization: authorization(options), body });
        const item = chatQueue.shift() || { text: "Subscription response." };
        if (item.beforeState) {
          push(item.beforeState);
          await new Promise((resolve) => setTimeout(resolve, 30));
        }
        if (item.code) {
          return new Response(JSON.stringify({ error: { code: item.code, message: item.message || item.code } }), {
            status: item.status || 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (item.search) {
          return new Response(new ReadableStream({ start(controller) {
            const send = (value) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
            send({ object: "rabbithole.search", type: "search", id: "ui-search", status: "searching", action: "search" });
            finishSearch = () => {
              send({ object: "rabbithole.search", type: "search", id: "ui-search", status: "completed", action: "search" });
              send({ choices: [{ delta: { content: item.text } }] });
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              finishSearch = null;
            };
          } }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
        }
        const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: item.text } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }
      return realFetch(input, options);
    };
  }, { eventsUrl: BRIDGE_EVENTS_URL, chatUrl: BRIDGE_CHAT_URL, pingUrl: BRIDGE_PING_URL, restartUrl: "http://127.0.0.1:41414/bridge/restart" });
}
