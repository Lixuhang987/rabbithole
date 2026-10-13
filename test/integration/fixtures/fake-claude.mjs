#!/usr/bin/env node
import fs from "node:fs";

const args = process.argv.slice(2);

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (args[0] === "--version") {
  process.stdout.write("2.1.220 (Claude Code fake)\n");
  process.exit(0);
}

if (args[0] === "auth" && args[1] === "status") {
  const signedIn = process.env.FAKE_CLAUDE_SIGNED_OUT !== "1";
  emit({
    loggedIn: signedIn,
    authMethod: signedIn ? "claude.ai" : "none",
    apiProvider: "firstParty",
    ...(signedIn ? { subscriptionType: "max" } : {}),
  });
  process.exit(signedIn ? 0 : 1);
}

if (args.includes("/model")) {
  emit({
    type: "result",
    is_error: false,
    result: "Available: sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], fable[1m], opusplan, default, or a full model ID.",
  });
  process.exit(0);
}

if (process.env.FAKE_CLAUDE_EXIT_BEFORE_STDIN === "1") {
  process.exit(23);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", async () => {
  const request = JSON.parse(input.trim());
  if (process.env.FAKE_CLAUDE_RECORD) {
    fs.appendFileSync(process.env.FAKE_CLAUDE_RECORD, `${JSON.stringify({
      args,
      request,
      claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    })}\n`);
  }
  const content = request.message?.content || [];
  const text = content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
  const hasImage = content.some((part) => part.type === "image");
  emit({
    type: "system",
    subtype: "init",
    tools: [],
    mcp_servers: [],
    model: "claude-sonnet-fake",
    slash_commands: [],
  });

  if (text.includes("OVERSIZED_LINE")) {
    process.stdout.write("x".repeat((1024 * 1024) + 1));
    return;
  }

  if (text.includes("SIGNED_OUT")) {
    emit({
      type: "result",
      is_error: true,
      result: "Not logged in. Run /login.",
      terminal_reason: "error",
      api_error_status: 401,
    });
    return;
  }

  if (text.includes("RAW_FAILURE")) {
    emit({
      type: "result",
      is_error: true,
      result: "internal failure at /Users/private/secret.js",
      terminal_reason: "error",
    });
    return;
  }

  if (text.includes("SLOW")) {
    emit({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "working" },
      },
    });
    const timer = setInterval(() => {}, 1000);
    process.on("SIGTERM", () => {
      clearInterval(timer);
      if (process.env.FAKE_CLAUDE_KILLED) {
        fs.writeFileSync(process.env.FAKE_CLAUDE_KILLED, "SIGTERM\n");
      }
      process.exit(0);
    });
    return;
  }

  if (text.includes("LONG_RESPONSE")) await new Promise((resolve) => setTimeout(resolve, 250));
  const answer = hasImage ? "RED" : "OK";
  for (const delta of [answer.slice(0, 1), answer.slice(1)]) {
    if (!delta) continue;
    emit({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: delta },
      },
    });
  }
  emit({
    type: "stream_event",
    event: {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { input_tokens: 7, output_tokens: answer.length },
    },
  });
  emit({
    type: "result",
    is_error: false,
    result: answer,
    terminal_reason: "completed",
    usage: { input_tokens: 7, output_tokens: answer.length },
  });
});
