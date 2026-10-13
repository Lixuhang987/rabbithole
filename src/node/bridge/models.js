export function codexModelEntry(model) {
  const options = (model.supportedReasoningEfforts || [])
    .map((effort) => typeof effort === "string" ? effort : effort?.reasoningEffort)
    .filter(Boolean);
  const defaultEffort = model.defaultReasoningEffort || options[0] || "medium";
  const images = Array.isArray(model.inputModalities) && model.inputModalities.includes("image");
  return {
    id: model.model,
    name: model.displayName || model.name || model.model,
    reasoning: {
      options: options.length ? [...new Set(options)] : [defaultEffort],
      default: defaultEffort,
    },
    images,
  };
}
