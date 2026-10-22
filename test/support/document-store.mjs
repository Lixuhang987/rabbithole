import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { FsStore } from "../../src/node/bridge/store/fs-store.js";
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rabbithole-documents-"));
after(() => fs.rm(directory, { recursive: true, force: true }));
export function documentStore() { return new FsStore({ directory: path.join(directory, crypto.randomUUID()) }); }
