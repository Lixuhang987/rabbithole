import 'fake-indexeddb/auto';
import { IdbStore } from '../../src/web/store/idb-store.js';
export function browserStore() { return new IdbStore({ dbName: `rabbithole-test-${crypto.randomUUID()}` }); }
if (typeof globalThis.FileReader !== 'function') globalThis.FileReader = /** @type {any} */ (class {
  result = null; error = null; onload = null; onerror = null;
  readAsDataURL(blob) {
    blob.arrayBuffer().then((bytes) => { this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}`; this.onload?.(); },
      (error) => { this.error = error; this.onerror?.(); });
  }
});
