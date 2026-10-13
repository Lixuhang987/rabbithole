/**
 * Normalizes the bridge catalog into the shape consumed by settings.
 * Unknown vision support is `null`; model availability remains a backend decision.
 *
 * @param {any} value
 * @returns {{id: string, name: string, vision: boolean | null, reasoning: {options: string[], default: string} | null}}
 */
export function modelDescriptor(value) {
  const reasoning = value?.reasoning && Array.isArray(value.reasoning.options)
    ? {
      options: value.reasoning.options.map(String),
      default: String(value.reasoning.default || value.reasoning.options[0] || ""),
    }
    : null;
  const descriptor = {
    id: String(value?.id || ""),
    name: String(value?.name || value?.id || ""),
    vision: typeof value?.images === "boolean" ? value.images : null,
    reasoning,
  };
  return descriptor;
}
