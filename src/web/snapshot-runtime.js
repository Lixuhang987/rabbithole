const sourcePromises = new Map();

function versionedAssetUrl(name) {
  const url = new URL(name, document.baseURI);
  const app = /** @type {HTMLScriptElement | null} */ (document.querySelector('script[type="module"][src*="app.js"]'));
  if (app?.src) {
    const version = new URL(app.src, document.baseURI).searchParams.get("v");
    if (version) url.searchParams.set("v", version);
  }
  return url.href;
}

function getSource(name, label) {
  if (!sourcePromises.has(name)) {
    const request = fetch(versionedAssetUrl(name)).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to load ${label} for the offline snapshot`);
      return response.text();
    }).catch((error) => {
      sourcePromises.delete(name);
      throw error;
    });
    sourcePromises.set(name, request);
  }
  return sourcePromises.get(name);
}

export function getFrozenClientSource() {
  return getSource("frozen-client.js", "the frozen client");
}

export function getDompurifySource() {
  return getSource("dompurify.js", "DOMPurify");
}

export function getFrozenStylesheet() {
  return getSource("frozen-styles.css", "the frozen stylesheet");
}
