import { TitleSentinelParser } from "./title-sentinel.js";

/** Adapt raw provider text to the shared GenerationEvent vocabulary. */
export async function* adaptTextGeneration(chunks) {
  for await (const delta of chunks) {
    if (typeof delta === "string") {
      if (delta) yield { type: "text", delta };
    } else yield delta;
  }
}

/** Branch-only adapter. Sentinel state is deliberately contained here. */
export async function* adaptBranchGeneration(chunks, { fallbackTitle = "Untitled" } = {}) {
  const parser = new TitleSentinelParser({ fallbackTitle });
  let titleEmitted = false;
  for await (const chunk of chunks) {
    if (typeof chunk !== "string" && chunk.type !== "text") {
      yield chunk;
      continue;
    }
    const delta = parser.push(typeof chunk === "string" ? chunk : chunk.delta);
    if (parser.decided && !titleEmitted) {
      titleEmitted = true;
      yield { type: "title", title: parser.title };
    }
    if (delta) yield { type: "text", delta };
  }
  const tail = parser.finish();
  if (!titleEmitted) yield { type: "title", title: parser.title };
  if (tail) yield { type: "text", delta: tail };
}
