import fs from "node:fs";
import { fileURLToPath } from "node:url";

export function devEnabled() {
  return !!process.env.RABBITHOLE_DEV;
}

/**
 * Reader for one built file. Production memoizes the first read; dev re-reads
 * when the file's mtime moves and otherwise returns the cached text.
 */
export function createSourceReader(target) {
  const filePath = target instanceof URL ? fileURLToPath(target) : target;
  let cached = null;

  if (!devEnabled()) {
    return function readFile() {
      if (cached !== null) return cached;
      cached = fs.readFileSync(filePath, "utf8");
      return cached;
    };
  }

  let stamp = null;
  return function readFileLive() {
    try {
      const mtime = fs.statSync(filePath).mtimeMs;
      if (cached === null || mtime !== stamp) {
        cached = fs.readFileSync(filePath, "utf8");
        stamp = mtime;
      }
    } catch (error) {
      if (cached === null) throw error;
    }
    return cached;
  };
}

