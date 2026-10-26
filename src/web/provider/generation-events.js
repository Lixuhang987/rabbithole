/** Adapt raw provider text to the shared GenerationEvent vocabulary. */
export async function* adaptTextGeneration(chunks) {
  for await (const delta of chunks) {
    if (typeof delta === "string") {
      if (delta) yield { type: "text", delta };
    } else yield delta;
  }
}
