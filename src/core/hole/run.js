/**
 * Pure provider-event accumulator and document-event builder.
 *
 * Browser branch/root/authoring share this unit. Hosts continue
 * to own lifecycle, retries, aborts, timers, persistence, and id minting.
 */
export class Run {
  /** @param {{ id: string, initialMarkdown?: string, fallbackTitle?: string }} options */
  constructor({ id, initialMarkdown = "", fallbackTitle = "Untitled" }) {
    if (typeof id !== "string" || !id) throw new TypeError("Run id must be a non-empty string");
    if (typeof initialMarkdown !== "string") throw new TypeError("Run initialMarkdown must be a string");
    if (typeof fallbackTitle !== "string") throw new TypeError("Run fallbackTitle must be a string");
    this.id = id;
    this.seq = 0;
    this.markdown = initialMarkdown;
    this.title = fallbackTitle;
  }

  /**
   * Accumulate one provider event. Text events return a full-text progress
   * event; title events update completion state and return null.
   * @param {any} event
   * @param {{ nodeId?: string, progressFields?: Record<string, unknown> }} [context]
   * @returns {any}
   */
  accept(event, context = {}) {
    if (!event || typeof event !== "object") throw new TypeError("Run event must be an object");
    if (event.type === "title") {
      if (typeof event.title !== "string") throw new TypeError("Run title must be a string");
      this.title = event.title;
      return null;
    }
    if (event.type !== "text") throw new TypeError("Unsupported GenerationEvent type");
    if (typeof event.delta !== "string") throw new TypeError("Run text delta must be a string");
    if (typeof context.nodeId !== "string" || !context.nodeId) throw new TypeError("Run text acceptance requires a non-empty nodeId");
    this.markdown += event.delta;
    this.seq += 1;
    return {
      type: "node_progress",
      ...(context.progressFields || {}),
      node_id: context.nodeId,
      markdown: this.markdown,
      run: { id: this.id, seq: this.seq },
    };
  }

  /** @param {{ nodeId: string, answeredFields?: Record<string, unknown> }} context @returns {any} */
  complete({ nodeId, answeredFields = {} }) {
    if (typeof nodeId !== "string" || !nodeId) throw new TypeError("Run completion requires a non-empty nodeId");
    return {
      type: "node_answered",
      ...answeredFields,
      node_id: nodeId,
      title: this.title,
      markdown: this.markdown,
    };
  }

  /** @returns {{ id: string, seq: number, markdown: string, title: string }} */
  snapshot() {
    return { id: this.id, seq: this.seq, markdown: this.markdown, title: this.title };
  }
}
