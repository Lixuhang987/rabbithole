import { StringDecoder } from "node:string_decoder";

export const MAX_NDJSON_LINE_CHARS = 1024 * 1024;

/**
 * Incremental UTF-8 NDJSON reader shared by the native backend protocol.
 * @param {{onRecord: (record: any, line: string) => void, onLine?: (line: string) => void, onMalformed?: (line: string, error: unknown) => void, maxLineChars?: number}} options
 */
export function createNdjsonReader({
  onRecord,
  onLine = (_line) => {},
  onMalformed = (_line, _error) => {},
  maxLineChars = MAX_NDJSON_LINE_CHARS,
}) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  function consume(final = false) {
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      processLine(line);
    }
    if (buffer.length > maxLineChars) throw new RangeError("NDJSON line exceeds the configured limit");
    if (final && buffer) {
      const line = buffer.replace(/\r$/, "");
      buffer = "";
      processLine(line);
    }
  }

  function processLine(line) {
    if (!line.trim()) return;
    if (line.length > maxLineChars) throw new RangeError("NDJSON line exceeds the configured limit");
    onLine(line);
    try {
      onRecord(JSON.parse(line), line);
    } catch (error) {
      onMalformed(line, error);
    }
  }

  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      consume();
    },
    end(chunk) {
      if (chunk != null) buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      buffer += decoder.end();
      consume(true);
    },
    reset() {
      buffer = "";
      decoder.end();
    },
  };
}
