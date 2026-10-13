#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const configPath = path.join(process.env.CODEX_HOME || path.join(process.env.HOME, ".codex"), "config.toml");
const config = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
const requiresOpenaiAuth = !/^\s*requires_openai_auth\s*=\s*false\s*$/m.test(config);
if (process.env.FAKE_CODEX_APP_SERVER_ARGS) {
  fs.appendFileSync(process.env.FAKE_CODEX_APP_SERVER_ARGS, `${JSON.stringify({
    args,
    codexHome: process.env.CODEX_HOME,
    config: config || null,
  })}\n`);
}
if (args[0] === "mcp") {
  process.stdout.write(JSON.stringify([{ name: "user_server", enabled: true }]));
  process.exit(0);
}
if (args[0] !== "app-server") process.exit(2);

let threadCounter = 0;
let turnCounter = 0;
let active = 0;
let maxActive = 0;
const turns = new Map();
const failedOnce = new Set();
const historyFile = process.env.FAKE_CODEX_HISTORY;
const stored = historyFile && fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, "utf8")) : {};
threadCounter = stored.counter || 0;
const threads = new Map(stored.threads || []);
function saveHistory() {
  if (historyFile) fs.writeFileSync(historyFile, JSON.stringify({ counter: threadCounter, threads: [...threads].filter(([, thread]) => thread.ephemeral === false) }));
}
function recordProtocol(method, params, threadId) {
  if (process.env.FAKE_CODEX_PROTOCOL_RECORD) fs.appendFileSync(process.env.FAKE_CODEX_PROTOCOL_RECORD, JSON.stringify({ method, params, threadId }) + "\n");
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function recordConcurrency() {
  if (process.env.FAKE_CODEX_CONCURRENCY) {
    fs.writeFileSync(process.env.FAKE_CODEX_CONCURRENCY, `${maxActive}\n`);
  }
}

function complete(threadId, turnId) {
  if (!turns.has(turnId)) return;
  const turn = turns.get(turnId);
  turns.delete(turnId);
  active -= 1;
  if (turn.search) {
    if (turn.failSearch) {
      emit({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", error: { message: "search endpoint returned 403" } } } });
      return;
    }
    emit({ method: "item/completed", params: { threadId, turnId, item: {
      type: "webSearch", id: `search-${turnId}`, query: "test search", action: { type: "search", query: "test search" },
      results: [
        { type: "text_result", ref_id: "turn0search0", url: "https://example.com/search-result", title: "Search [Result]", future_field: true },
        { type: "text_result", ref_id: "turn0search1", url: "javascript:alert(1)", title: "Unsafe" },
      ],
    } } });
  }
  const text = turn.answer || "OK";
  threads.get(threadId)?.history.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
  saveHistory();
  const split = text.includes("cite") ? text.indexOf("cite") + 3 : 1;
  emit({
    method: "item/agentMessage/delta",
    params: { threadId, turnId, delta: text.slice(0, split) },
  });
  emit({
    method: "item/agentMessage/delta",
    params: { threadId, turnId, delta: text.slice(split) },
  });
  emit({
    method: "item/completed",
    params: {
      threadId,
      turnId,
      item: { type: "agentMessage", text },
    },
  });
  emit({
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      turnId,
      tokenUsage: { last: { inputTokens: 9, outputTokens: 2, totalTokens: 11 } },
    },
  });
  emit({
    method: "turn/completed",
    params: {
      threadId,
      turn: { id: turnId, status: "completed", error: null },
    },
  });
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  const lines = input.split(/\r?\n/);
  input = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    const { id, method, params = {} } = JSON.parse(line);
    if (method === "initialize") {
      emit({ id, result: { userAgent: "codex-cli 0.144.0-fake" } });
    } else if (method === "initialized") {
      // notification
    } else if (method === "account/read") {
      emit({
        id,
        result: !requiresOpenaiAuth || process.env.FAKE_CODEX_SIGNED_OUT === "1"
          ? { account: null, requiresOpenaiAuth }
          : { account: { type: "chatgpt" }, planType: "pro", requiresOpenaiAuth },
      });
    } else if (method === "collaborationMode/list") {
      emit({
        id,
        result: {
          data: [
            { mode: "plan", settings: {} },
            { mode: "default", settings: {} },
          ],
        },
      });
    } else if (method === "model/list") {
      emit({
        id,
        result: params.cursor
          ? {
            data: [{
              model: "gpt-second",
              displayName: "GPT Second",
              hidden: false,
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
              inputModalities: ["text"],
            }],
            nextCursor: null,
          }
          : {
            data: [{
              model: "gpt-fake",
              displayName: "GPT Fake",
              hidden: false,
              defaultReasoningEffort: "low",
              supportedReasoningEfforts: [
                { reasoningEffort: "low" },
                { reasoningEffort: "medium" },
                { reasoningEffort: "xhigh" },
              ],
              inputModalities: ["text", "image"],
            }],
            nextCursor: "page-2",
          },
      });
    } else if (method === "thread/start") {
      const threadId = `thread-${++threadCounter}`;
      threads.set(threadId, { ...params, history: [] });
      saveHistory();
      recordProtocol(method, params, threadId);
      if (process.env.FAKE_CODEX_THREAD_RECORD) fs.appendFileSync(process.env.FAKE_CODEX_THREAD_RECORD, `${JSON.stringify(params)}\n`);
      emit({ id, result: { thread: { id: threadId, ephemeral: params.ephemeral } } });
    } else if (method === "thread/inject_items") {
      threads.get(params.threadId).history.push(...structuredClone(params.items));
      saveHistory();
      recordProtocol(method, params, params.threadId);
      emit({ id, result: {} });
    } else if (method === "thread/fork") {
      const source = threads.get(params.threadId);
      if (!source || source.ephemeral !== false) {
        emit({ id, error: { code: -32600, message: "no rollout found for thread id " + params.threadId } });
        continue;
      }
      const threadId = `thread-${++threadCounter}`;
      threads.set(threadId, { ...source, ...params, history: structuredClone(source.history) });
      saveHistory();
      recordProtocol(method, params, threadId);
      emit({ id, result: { thread: { id: threadId, ephemeral: params.ephemeral } } });
    } else if (method === "thread/unsubscribe") {
      recordProtocol(method, params, params.threadId);
      emit({ id, result: { status: "unsubscribed" } });
    } else if (method === "turn/start") {
      const turnId = `turn-${++turnCounter}`;
      if (process.env.FAKE_CODEX_RECORD) {
        fs.appendFileSync(process.env.FAKE_CODEX_RECORD, `${JSON.stringify({ ...params, inheritedHistory: structuredClone(threads.get(params.threadId)?.history || []) })}\n`);
      }
      threads.get(params.threadId)?.history.push({ type: "message", role: "user", content: params.input });
      saveHistory();
      emit({ id, result: { turn: { id: turnId, status: "inProgress" } } });
      emit({
        method: "turn/started",
        params: {
          threadId: params.threadId,
          turn: { id: turnId, status: "inProgress" },
        },
      });
      active += 1;
      maxActive = Math.max(maxActive, active);
      recordConcurrency();
      const text = params.input?.map((part) => part.text || "").join("\n") || "";
      const search = process.env.FAKE_CODEX_WEB_SEARCH !== "disabled" && text.includes("SEARCH");
      const branch = text.includes("SEARCH branch");
      const answer = text.includes("ECHO_LARGE") ? text : text.includes("SEARCH")
        ? `${branch ? "TITLE: Search branch" : "# Search answer"}\nFound online citeturn0search0. Missing citeturn0search1.`
        : "OK";
      if (search) {
        const item = { type: "agentMessage", id: `commentary-${turnId}`, phase: "commentary", text: "I will search now." };
        emit({ method: "item/started", params: { threadId: params.threadId, turnId, item } });
        emit({ method: "item/agentMessage/delta", params: { threadId: params.threadId, turnId, itemId: item.id, delta: item.text } });
        emit({ method: "item/completed", params: { threadId: params.threadId, turnId, item } });
      }
      if (search) emit({ method: "item/started", params: { threadId: params.threadId, turnId, item: { type: "webSearch", id: `search-${turnId}`, query: "", action: null, results: null } } });
      const timer = text.includes("SLOW")
        ? null
        : setTimeout(() => complete(params.threadId, turnId), 20);
      turns.set(turnId, { threadId: params.threadId, timer, search, answer, failSearch: text.includes("SEARCH FAIL") && (!text.includes("FAIL ONCE") || !failedOnce.has(text)) });
      failedOnce.add(text);
    } else if (method === "turn/interrupt") {
      recordProtocol(method, params, params.threadId);
      const turn = turns.get(params.turnId);
      if (turn) {
        if (turn.timer) clearTimeout(turn.timer);
        turns.delete(params.turnId);
        active -= 1;
      }
      emit({ id, result: {} });
      emit({
        method: "turn/completed",
        params: {
          threadId: params.threadId,
          turn: { id: params.turnId, status: "interrupted", error: null },
        },
      });
    }
  }
});

process.on("SIGTERM", () => process.exit(0));
