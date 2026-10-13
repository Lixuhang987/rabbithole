import { buildNodeAnsweredEvent } from "../../core/hole-host.js";
import { isNoteNode } from "../../core/hole/ask.js";
import { normalizePdfExtension } from "../../core/pdf-shared.js";
import { materializePdfFigures } from "../../core/pdf/figures.js";
import { normalizeProviderError } from "../provider/errors.js";
import { cropPdfSourceToBlob, cropPdfSourceToDataUrl } from "../pdf-crop.js";
import { DirectHostBase } from "./direct-host-base.js";
import { rawPdfExtension, requireReadableArticle } from "./direct-host-values.js";

/** PDF transcription, figures, and extension lifecycle. */
export class DirectHostPdf extends DirectHostBase {
  async handleBranchRequest(payload) {
    const parentId = payload.parent_id === null ? null : String(payload.parent_id || "");
    const parent = this.state.nodes.get(parentId ?? this.state.root_id);
    requireReadableArticle(parent);
    const nodeId = String(payload.node_id || "");
    const replacedNote = this.state.nodes.get(nodeId);
    if (isNoteNode(replacedNote)) this.noteConversions.set(nodeId, replacedNote);
    let result;
    try {
      result = this.dispatch({ ...payload, type: "branch_request" }, { now: new Date().toISOString() });
    } catch (error) {
      this.noteConversions.delete(nodeId);
      throw error;
    }
    const node = result.createdNode;
    await this.flushSave();
    this.startAnswer(node.id, { reset: false });
    return { ok: true, node_id: node.id, request_id: payload.request_id };
  }

  async handleNodeCreate(payload) {
    const result = await this.engine.nodeCreate(payload);
    this.state = this.engine.state;
    return result;
  }

  handleConvertCancel(payload) {
    this.abortByNode.get(String(payload.node_id || ""))?.abort();
    return { ok: true };
  }

  handleConvertPdf(payload) {
    const nodeId = String(payload.node_id || ""), node = this.state.nodes.get(nodeId), pdf = normalizePdfExtension(node);
    if (!pdf) throw new Error("This node is not a native PDF.");
    for (const candidate of this.state.nodes.values()) {
      if (candidate.parent_id === nodeId && !isNoteNode(candidate)) throw new Error("Create a text version before asking follow-ups.");
    }
    if (pdf.converting || this.abortByNode.has(nodeId)) throw new Error("Conversion is already running.");
    const capability = this.getPdfTranscriptionCapability?.();
    if (capability?.available === false) throw new Error(capability.reason || "Choose a vision-capable model before converting.");
    if (!this.provider?.transcribePages) throw new Error("Choose a model before converting.");
    const controller = new AbortController(); this.abortByNode.set(nodeId, controller);
    const original = node.markdown;
    this.patchPdf(nodeId, { ...pdf, converting: true, converted: false, original_markdown: original });
    queueMicrotask(() => this.runPdfConversion(nodeId, controller).catch((error) => this.failPdfConversion(nodeId, error)));
    return { ok: true, node_id: nodeId };
  }

  async runPdfConversion(nodeId, controller) {
    const node = this.state.nodes.get(nodeId), pdf = normalizePdfExtension(node);
    const batches = []; for (let i = 0; i < pdf.pages.length; i += 5) batches.push(pdf.pages.slice(i, i + 5));
    let committed = "";
    const figureBudget = { bytes: 0 };
    const start = (batch, tail) => this.transcribePdfBatch(batch, tail, controller.signal);
    let pending = batches.length ? start(batches[0], "") : Promise.resolve("");
    for (let i = 0; i < batches.length; i++) {
      let chunk = await pending;
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      pending = i + 1 < batches.length ? start(batches[i + 1], (committed + chunk).slice(-500)) : null;
      chunk = await this.materializeWebFigures(nodeId, chunk, pdf, i, figureBudget);
      committed += (committed && chunk ? "\n\n" : "") + chunk;
      this.dispatch({ type: "node_progress", node_id: nodeId, markdown: committed });
      this.emit({ type: "pdf_convert_progress", node_id: nodeId, markdown: committed, page_done: batches[i].at(-1).n, page_total: pdf.pages.length });
      this.scheduleSave();
    }
    const current = this.state.nodes.get(nodeId);
    this.dispatch({ ...buildNodeAnsweredEvent(current), markdown: committed });
    // Spread the extension captured at run start: the body is now the converted
    // document, so re-normalizing would fail and the patch would wipe the
    // pages/lines/original_markdown stash the extension exists to keep.
    this.patchPdf(nodeId, { ...pdf, converting: false, converted: true });
    this.abortByNode.delete(nodeId); this.emit(buildNodeAnsweredEvent(this.state.nodes.get(nodeId))); await this.flushSave();
  }

  async transcribePdfBatch(batch, tail, signal) {
    try {
      return await this.transcribePdfBatchOnce(batch, tail, signal);
    } catch (error) {
      const normalized = normalizeProviderError(error);
      if (normalized.code !== "payload_too_large" || batch.length < 2) throw error;
      const halfway = Math.ceil(batch.length / 2);
      const first = await this.transcribePdfBatchOnce(batch.slice(0, halfway), tail, signal);
      const secondTail = `${tail}${tail && first ? "\n\n" : ""}${first}`.slice(-500);
      const second = await this.transcribePdfBatchOnce(batch.slice(halfway), secondTail, signal);
      return `${first}${first && second ? "\n\n" : ""}${second}`;
    }
  }

  async transcribePdfBatchOnce(batch, tail, signal) {
    const node = this.state.nodes.get(this.state.root_id);
    const pdf = normalizePdfExtension(node);
    const source = await this.store.getAsset(this.holeId, pdf.source.asset);
    const pages = await Promise.all(batch.map(async (page) => ({
      n: page.n,
      data_url: await cropPdfSourceToDataUrl(source, {
        sourceKey: pdf.source.sha256,
        pageNumber: page.n,
        normalizedRect: { x: 0, y: 0, w: 1, h: 1 },
        padding: 0,
        maxLongEdge: 2400,
      }),
    })));
    let output = "";
    for await (const event of this.provider.transcribePages({ pages, tail }, signal)) {
      if (event.type === "text") output += event.delta;
    }
    return output.trim();
  }

  async materializeWebFigures(nodeId, markdown, pdf, batchIndex, figureBudget = { bytes: 0 }) {
    return materializePdfFigures({ markdown, pdf, figureBudget,
      assetCount: async () => (await this.store.listAssets(this.holeId)).length,
      makeName: (ref, ordinal) => `fig-p${String(ref.page).padStart(3, "0")}-${batchIndex * 20 + ordinal}.png`,
      materialize: async ({ ref, page, name }) => {
        const blob = await cropPdfSourceToBlob(await this.store.getAsset(this.holeId, pdf.source.asset), {
          sourceKey: pdf.source.sha256, pageNumber: page.n, normalizedRect: ref.rect, padding: 0, maxLongEdge: 2048,
        });
        await this.store.putAsset(this.holeId, name, blob); this.registerAssetUrl?.(name, blob);
        return { bytes: blob.size };
      },
      discard: async (name) => { await this.store.deleteAsset(this.holeId, name); this.revokeAssetUrl?.(name); },
    });
  }

  patchPdf(nodeId, value) { this.engine.patchExtension(nodeId, "pdf", value); this.state = this.engine.state; }
  restorePdfConversion(nodeId, pdf) { this.engine.restorePdfConversion(nodeId, pdf); this.state = this.engine.state; }
  failPdfConversion(nodeId, error) { const raw = rawPdfExtension(this.state.nodes.get(nodeId)); if (raw?.version === 2) this.restorePdfConversion(nodeId, raw); this.abortByNode.delete(nodeId); if (error?.name !== "AbortError") this.onToast?.({ message: `PDF conversion failed: ${error?.message || error}` }); }

  async handleExtensionsPatch(payload) {
    const result = this.applyPersistedBrowserEvent(payload);
    this.emit({ type: "node_extensions_patch", node_id: payload.node_id, namespace: payload.namespace, value: payload.value });
    // Canvas pins, docked-note presentation, and other extension-backed UI
    // state must survive an immediate navigation. A later debounced node update
    // can otherwise keep resetting the save timer and widen the durability
    // window to the sum of both debounces.
    await this.flushSave();
    return result;
  }

}
