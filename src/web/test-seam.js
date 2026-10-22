/*
 * Rule 10 test contract: this is the sole shipped test seam. Every entry below
 * exists only for state or artifact inspection that cannot be observed through
 * the product UI; product actions themselves must be driven through real UI.
 */
export function installTestSeam({
  getStore,
  currentHoleId,
  createDocument,
  waitForCanvasViewSettled,
  selectionAnchorClipBounds,
  exportSnapshot,
  exportPortable,
  autoTidyClock,
}) {
  const seam = {
    // Routing/reload tests need the raw persistence identity, which the product UI does not expose.
    currentHoleId,
    // Browser tests inspect canonical records through the same storage interface.
    readStoredHole: async (id = currentHoleId()) => id ? getStore().loadHole(id) : null,
    // Asset-ingest tests need binary asset names and byte sizes, which rendered product content cannot reveal.
    inspectAssets: async (id = currentHoleId()) => {
      const store = getStore();
      const assets = !id
        ? []
        : typeof store.getAssets === "function"
          ? await store.getAssets(id)
          : await Promise.all((await store.listAssets(id)).map(async (name) => ({ name, blob: await store.getAsset(id, name) })));
      const names = [];
      const sizes = {};
      for (const { name, blob } of assets) {
        names.push(name);
        sizes[name] = blob?.size || 0;
      }
      return { names, sizes };
    },
    // Asset tests need binary Blob types, which live rendering hides.
    inspectAssetType: async (name, id = currentHoleId()) => (await getStore().getAsset(id, name))?.type || "",
    // Empty-store persistence tests need raw persistence record counts, which empty product chrome cannot distinguish.
    listStoredHoles: () => getStore().listHoles(),
    // Structured-authoring tests need model rewrite fixtures, for which the product has no equivalent UI action.
    createDocument,
    // Camera glides run in a JavaScript rAF loop, outside the Web Animations API.
    // Selection tests need its real completion promise before emulating a user gesture.
    waitForCanvasViewSettled,
    // Keep synthetic selection visibility on the product's exact visual-viewport/overflow geometry.
    selectionAnchorClipBounds,
    // Snapshot byte/content tests need pre-download artifact strings, which the download UI cannot return.
    exportSnapshot,
    // Portable-projection tests need pre-download artifact strings to compare with the snapshot HTML carrier.
    exportPortable,
  };
  if (typeof autoTidyClock?.advance === "function") {
    // Time is environmental state: tests still drive every product action through the real UI.
    seam.advanceAutoTidyClock = (ms) => autoTidyClock.advance(ms);
  }
  window.__rabbitholeTest = Object.freeze(seam);
}
