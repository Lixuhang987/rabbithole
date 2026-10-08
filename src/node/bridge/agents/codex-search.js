const CITE_START = "cite";
const CITE_END = "";

/** Codex result DTOs are opaque; only verified public URLs become citations. */
export function searchSources(results) {
  const sources = [];
  for (const result of Array.isArray(results) ? results.slice(0, 256) : []) {
    if (typeof result?.ref_id !== "string" || typeof result?.url !== "string") continue;
    try {
      const url = new URL(result.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
      sources.push({
        ref_id: result.ref_id,
        url: url.href.replace(/[<>\s]/g, (char) => encodeURIComponent(char)),
        title: String(result.title || url.hostname).replace(/[\r\n]+/g, " ").slice(0, 300),
      });
    } catch {
      // A new or malformed DTO must not create an unsafe link.
    }
  }
  return sources;
}

/** Hold incomplete references until their source arrives or the turn completes. */
export class SearchCitations {
  constructor() {
    this.sources = new Map();
    this.buffer = "";
  }

  add(sources) {
    for (const source of sources) this.sources.set(source.ref_id, source);
  }

  push(text, final = false) {
    this.buffer += text;
    let output = "";
    while (this.buffer) {
      const start = this.buffer.indexOf(CITE_START);
      if (start < 0) {
        let held = 0;
        for (let size = 1; size < CITE_START.length; size++) {
          if (CITE_START.startsWith(this.buffer.slice(-size))) held = size;
        }
        output += held ? this.buffer.slice(0, -held) : this.buffer;
        this.buffer = held ? this.buffer.slice(-held) : "";
        if (final && held) { output += "(source unavailable)"; this.buffer = ""; }
        break;
      }
      output += this.buffer.slice(0, start);
      this.buffer = this.buffer.slice(start);
      const end = this.buffer.indexOf(CITE_END, CITE_START.length);
      if (end < 0) {
        if (final) { output += "(source unavailable)"; this.buffer = ""; }
        break;
      }
      const refs = this.buffer.slice(CITE_START.length, end).split("");
      if (!final && refs.some((ref) => !this.sources.has(ref))) break;
      const links = refs.map((ref) => {
        const source = this.sources.get(ref);
        if (!source) return "(source unavailable)";
        const title = source.title.replace(/[\\`*_[\]<>]/g, "\\$&");
        return `[${title}](<${source.url}>)`;
      });
      output += links.join(" ");
      this.buffer = this.buffer.slice(end + CITE_END.length);
    }
    return output;
  }

  finish() { return this.push("", true); }

  render(text) {
    const parser = new SearchCitations();
    parser.sources = this.sources;
    return parser.push(text, true);
  }
}
