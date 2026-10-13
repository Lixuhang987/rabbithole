import { systemClock } from "../../core/clock.js";
import { validateImageAssetName } from "../../core/assets.js";
import { HoleEngine } from "../../core/engine/hole-engine.js";
import { dispatchBrowserEvent } from "../../core/hole-host.js";
import { randomId } from "../../core/utils.js";
import { assertHostCommandHandlers, WEB_HOST_COMMANDS } from "../../core/vocabulary.js";
import { defaultRunId, rawPdfExtension } from "./direct-host-values.js";

const SAVE_DEBOUNCE_MS = 400;

/** Web-host state, adapter surface, and browser command boundary. */
export class DirectHostBase {
  /** @param {any} [options] */
  constructor({ store, hole, provider = null, providerRequiredError = null, registerAssetUrl = null, revokeAssetUrl = null, onToast = null, onDone = null, onAuthRequired = null, onProviderFailure = null, onRootAnswered = null, getPdfTranscriptionCapability = null, mintRunId = defaultRunId } = {}) {
    this.store = store;
    this.provider = provider;
    this.providerRequiredError = providerRequiredError;
    this.onEvent = null;
    this.onToast = onToast;
    this.onDone = onDone;
    this.onAuthRequired = onAuthRequired;
    this.onProviderFailure = onProviderFailure;
    this.onRootAnswered = onRootAnswered;
    this.getPdfTranscriptionCapability = getPdfTranscriptionCapability;
    this.mintRunId = mintRunId;
    this.registerAssetUrl = registerAssetUrl;
    this.revokeAssetUrl = revokeAssetUrl;
    this.engine = new HoleEngine({
      hole,
      debounceMs: SAVE_DEBOUNCE_MS,
      port: {
        store,
        emit: (event) => this.emit(event),
        clock: systemClock,
        ids: { newId: () => randomId("node") },
        onAssetDeleted: (name) => this.revokeAssetUrl?.(name),
      },
    });
    this.state = this.engine.state;
    this.holeId = this.state.hole_id;
    this.title = this.state.title;
    /** @type {ReturnType<typeof setTimeout> | 0} */ this.saveTimer = 0;
    this.saveChain = this.engine.saveChain;
    /** @type {Promise<any>} */ this.savingChain = Promise.resolve();
    this.abortByNode = new Map();
    this.noteConversions = new Map();
    this.lastEventId = 0;
    this.disposed = false;
    this.subscriptions = new Set();
    for (const node of this.state.nodes.values()) {
      // Raw read on purpose: a mid-run save persists the streamed body, which
      // normalizePdfExtension would reject against the original line offsets —
      // and that is exactly the state hydration must repair.
      const raw = rawPdfExtension(node);
      if (raw?.version === 2 && raw.converting) this.restorePdfConversion(node.id, raw);
    }
  }

  hydration() {
    return this.engine.hydration({ lastEventId: this.lastEventId, suppressRootOrigin: true });
  }

  adapter() {
    return {
      /** @param {{onOpen?: () => void, onMessage?: (event: any) => void}} hooks */
      connect: ({ onOpen, onMessage }) => {
        /** @type {any} */
        const subscription = {
          closed: false,
          openTimer: 0,
          callback: (event) => {
            if (!subscription.closed && !this.disposed) onMessage?.(event);
          },
          close: () => {
            if (subscription.closed) return;
            subscription.closed = true;
            if (subscription.openTimer) clearTimeout(subscription.openTimer);
            subscription.openTimer = 0;
            this.subscriptions.delete(subscription);
            if (this.onEvent === subscription.callback) this.onEvent = null;
          },
        };
        if (this.disposed) {
          subscription.closed = true;
          return { close: subscription.close };
        }
        this.subscriptions.add(subscription);
        this.onEvent = subscription.callback;
        subscription.openTimer = setTimeout(() => {
          subscription.openTimer = 0;
          if (!subscription.closed && !this.disposed) onOpen?.();
        }, 0);
        return { close: subscription.close };
      },
      post: (payload) => this.handleBrowserEvent(payload),
      putAsset: (name, blob) => this.putAsset(name, blob),
      deleteAsset: (name) => this.deleteAsset(name),
    };
  }

  async putAsset(name, blob) {
    const safeName = validateImageAssetName(name);
    if (!safeName.startsWith("paste-")) throw new Error("Pasted image asset names must start with paste-");
    if (await this.store.getAsset(this.holeId, safeName)) throw new Error(`Asset ${safeName} already exists`);
    await this.store.putAsset(this.holeId, safeName, blob);
    this.registerAssetUrl?.(safeName, blob);
    return { ok: true, name: safeName };
  }

  async deleteAsset(name) {
    const safeName = validateImageAssetName(name);
    if (!safeName.startsWith("paste-")) throw new Error("Only pasted image assets can be deleted here");
    await this.store.deleteAsset(this.holeId, safeName);
    this.revokeAssetUrl?.(safeName);
    return { ok: true, name: safeName };
  }

  async handleBrowserEvent(payload) {
    if (this.disposed) return { ok: false, error: "This Rabbithole is no longer active." };
    try {
      const handlers = assertHostCommandHandlers("web host", {
        branch_request: (event) => this.handleBranchRequest(event),
        node_create: (event) => this.handleNodeCreate(event),
        retry_branch: (event) => this.handleRetry(event),
        node_update: (event) => this.applyPersistedBrowserEvent(event),
        nodes_update: (event) => this.applyPersistedBrowserEvent(event),
        block_state: (event) => this.applyPersistedBrowserEvent(event),
        node_extensions_patch: (event) => this.handleExtensionsPatch(event),
        convert_pdf: (event) => this.handleConvertPdf(event),
        convert_cancel: (event) => this.handleConvertCancel(event),
        delete_node: (event) => this.handleDeleteNode(event),
        view_state: (event) => this.applyPersistedBrowserEvent(event),
        done: async () => { await this.flushSave(); this.onDone?.(); return { ok: true }; },
      }, WEB_HOST_COMMANDS);
      return await dispatchBrowserEvent(payload, {
        handlers,
        unsupported: (eventType) => { throw new Error(`Unsupported browser event: ${eventType}`); },
      });
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }


  handleBranchRequest(_event) { return Promise.resolve({ ok: false }); }
  handleNodeCreate(_event) { return Promise.resolve({ ok: false }); }
  handleRetry(_event) { return { ok: false }; }
  applyPersistedBrowserEvent(_event) { return { ok: false }; }
  handleExtensionsPatch(_event) { return Promise.resolve({ ok: false }); }
  handleConvertPdf(_event) { return { ok: false }; }
  handleConvertCancel(_event) { return { ok: false }; }
  handleDeleteNode(_event) { return Promise.resolve({ ok: false }); }
  restorePdfConversion(_nodeId, _pdf) {}
  startAnswer(_nodeId, _options = {}) {}
  isLivePending(_nodeId) { return false; }
  dispatch(_event, _options = {}) { return {}; }
  emit(_event) {}
  scheduleSave() {}
  /** @returns {Promise<unknown>} */ flushSave() { return Promise.resolve(); }
}
