import { BACKEND_CONVERSATION, normalizeBackendConversation } from "../../core/conversation.js";
import { MAX_ASK_ATTACHMENTS } from "../../core/attachments.js";
import { validateImageAssetName } from "../../core/assets.js";
import { isNoteNode } from "../../core/hole/ask.js";
import { Run } from "../../core/hole/run.js";
import { holeStateToHole } from "../../core/hole/reduce.js";
import { buildNodeAnsweredEvent } from "../../core/hole-host.js";
import { ProviderError, normalizeProviderError } from "../provider/errors.js";
import { DirectHostBase } from "./direct-host-base.js";
import {
  blobToDataUrl,
  branchAnsweredFields,
  fallbackTitleForNode,
  generationDocEvents,
  isAuthError,
  rawOrigin,
  resetMarkdownForRun,
  rootAnsweredFields,
  rootQuestionForNode,
  rootQuestionMarkdown,
  titleFromMarkdown,
} from "./direct-host-values.js";

/** Provider generation, retries, error routing, and context assembly. */
export class DirectHostGeneration extends DirectHostBase {
  async handleBranchRequest(payload) {
    const parentId = payload.parent_id === null ? null : String(payload.parent_id || "");
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

  async handleExtensionsPatch(payload) {
    const result = this.applyPersistedBrowserEvent(payload);
    this.emit({ type: "node_extensions_patch", node_id: payload.node_id, namespace: payload.namespace, value: payload.value });
    await this.flushSave();
    return result;
  }

  handleRetry(payload) {
    const node = this.state.nodes.get(String(payload.node_id || ""));
    if (!node || node.status !== "pending") return { ok: true };
    if (node.id === this.state.root_id && rootQuestionForNode(node)) {
      this.startRootAnswer({ reset: true });
      return { ok: true };
    }
    this.startAnswer(node.id, { reset: true, withoutAttachment: payload.without_attachment === true });
    return { ok: true };
  }

  async handleDeleteNode(payload) {
    const targetId = String(payload.node_id || "");
    if (!targetId || targetId === this.state.root_id) return { ok: false, error: "The starting document can't be removed" };
    if (!this.state.nodes.has(targetId)) return { ok: true, deleted: [] };

    const result = await this.engine.deleteNode(targetId, {
      beforeDelete: (ids) => {
        for (const id of ids) {
          this.abortByNode.get(id)?.abort();
          this.abortByNode.delete(id);
          this.noteConversions.delete(id);
        }
      },
    });
    this.state = this.engine.state;
    return result;
  }

  dispatch(event, options) {
    if (event.type === "node_search_status") {
      this.emit(event);
      return {};
    }
    const effects = this.engine.dispatch(event, options);
    this.state = this.engine.state;
    return effects;
  }

  applyPersistedBrowserEvent(payload) {
    const result = this.engine.applyPersistedEvent(payload);
    this.state = this.engine.state;
    return result;
  }

  startAnswer(nodeId, { reset = false, withoutAttachment = false } = {}) {
    if (this.disposed) return;
    const node = this.state.nodes.get(nodeId);
    if (!node || node.status !== "pending") return;

    const controller = new AbortController();
    const previous = this.abortByNode.get(nodeId);
    if (previous) previous.abort();
    this.abortByNode.set(nodeId, controller);

    if (reset) {
      this.dispatchProgress(nodeId, "", { emit: true });
    }

    queueMicrotask(() => this.runAnswer(nodeId, controller, { withoutAttachment }).catch((err) => {
      this.handleAnswerError(nodeId, err, controller.signal);
    }));
  }

  startRootAnswer({ reset = false } = {}) {
    if (this.disposed) return false;
    const node = this.state.nodes.get(this.state.root_id);
    const question = rootQuestionForNode(node);
    if (!node || node.status !== "pending" || !question) return false;

    const controller = new AbortController();
    const previous = this.abortByNode.get(node.id);
    if (previous) previous.abort();
    this.abortByNode.set(node.id, controller);

    if (reset) {
      this.dispatchProgress(node.id, "", { emit: true });
    }

    queueMicrotask(() => this.runRootAnswer(node.id, question, controller).catch((err) => {
      this.handleAnswerError(node.id, err, controller.signal);
    }));
    return true;
  }

  async runRootAnswer(nodeId, question, controller) {
    const node = this.state.nodes.get(nodeId);
    if (!node || node.status !== "pending") return;
    if (!this.provider) {
      throw new ProviderError(this.providerRequiredError?.message || "Connect the bridge and choose a model to keep asking.", {
        status: 401,
        code: this.providerRequiredError?.code || "setup_incomplete",
        retryable: true,
      });
    }

    const provider = this.provider;
    const run = this.createRun({ ...node, markdown: "" }, node.title || "Untitled");
    const questionMarkdown = rootQuestionMarkdown(question);
    const generation = provider.authorExplainer({ question, nodeId }, controller.signal);
    for await (const docEvent of generationDocEvents(generation, run, {
      nodeId,
      progressFields: { base_url: node.base_url, base_url_source: node.base_url_source },
      answeredFields: () => rootAnsweredFields(this.state.nodes.get(nodeId)),
      beforeComplete: (activeRun) => {
        // Deliberate asymmetry: branches accept an empty stream, but a root
        // explainer preserves the existing empty/whitespace rejection surface.
        if (!activeRun.snapshot().markdown.trim()) throw new Error("The provider returned an empty document.");
        activeRun.accept({
          type: "title",
          title: titleFromMarkdown(activeRun.snapshot().markdown) || this.state.nodes.get(nodeId)?.title || "Untitled",
        });
      },
    })) {
      if (controller.signal.aborted || !this.isLivePending(nodeId)) return;
      if (docEvent.type === "node_progress" || docEvent.type === "node_answered") {
        docEvent.markdown = questionMarkdown + docEvent.markdown;
      }
      this.dispatch(docEvent);
      if (docEvent.type === "node_progress") {
        const current = this.state.nodes.get(nodeId);
        this.emit({ ...docEvent, markdown: current.markdown });
        this.scheduleSave();
      }
    }
    const title = this.state.nodes.get(nodeId).title;
    this.dispatch({ type: "hole_title", title });
    this.title = title;
    const finalNode = this.state.nodes.get(nodeId);
    this.abortByNode.delete(nodeId);
    this.emit(buildNodeAnsweredEvent(finalNode, { parent_id: null }));
    this.emitConversation(finalNode);
    await this.flushSave();
    await this.onRootAnswered?.(finalNode);
  }

  async runAnswer(nodeId, controller, { withoutAttachment = false } = {}) {
    const node = this.state.nodes.get(nodeId);
    if (!node || node.status !== "pending") return;
    if (!this.provider) {
      throw new ProviderError(this.providerRequiredError?.message || "Connect the bridge and choose a model to keep asking.", {
        status: 401,
        code: this.providerRequiredError?.code || "setup_incomplete",
        retryable: true,
      });
    }

    const provider = this.provider;
    const context = this.buildBranchContext(node);
    if (!withoutAttachment) await this.attachBranchImage(node, context);
    const fallbackTitle = fallbackTitleForNode(node);
    const association = this.state.nodes.get(context.parent_id)?.extensions?.[BACKEND_CONVERSATION];
    context.conversation = normalizeBackendConversation(association);
    if (association != null && !context.conversation) throw new ProviderError("The source article has an invalid session reference.", { code: "conversation_invalid" });
    if (controller.signal.aborted || this.disposed || !this.isLivePending(nodeId)) return;
    const run = this.createRun(this.state.nodes.get(nodeId), fallbackTitle);
    const generation = provider.answerBranch(context, controller.signal);
    for await (const docEvent of generationDocEvents(generation, run, {
      nodeId,
      progressFields: { base_url: node.base_url, base_url_source: node.base_url_source },
      answeredFields: () => branchAnsweredFields(this.state.nodes.get(nodeId)),
      beforeComplete: (activeRun) => {
        activeRun.accept({ type: "title", title: titleFromMarkdown(activeRun.snapshot().markdown) || fallbackTitle });
      },
    })) {
      if (controller.signal.aborted || this.disposed || !this.isLivePending(nodeId)) return;
      this.dispatch(docEvent);
      if (docEvent.type === "node_progress") {
        this.emit({ ...docEvent, markdown: this.state.nodes.get(nodeId).markdown });
        this.scheduleSave();
      }
    }

    // Branches deliberately accept an empty provider stream: completion uses
    // the fallback title and empty/reset markdown. Root generation still rejects.
    const finalNode = this.state.nodes.get(nodeId);
    this.abortByNode.delete(nodeId);
    this.noteConversions.delete(nodeId);
    this.emit(buildNodeAnsweredEvent(finalNode));
    this.emitConversation(finalNode);
    await this.flushSave();
  }

  emitConversation(node) {
    const conversation = normalizeBackendConversation(node?.extensions?.[BACKEND_CONVERSATION]);
    if (conversation) this.emit({ type: "node_extensions_patch", node_id: node.id, namespace: BACKEND_CONVERSATION, value: conversation });
  }

  async attachBranchImage(node, context) {
    const pastedAssets = [];
    for (const rawName of Array.isArray(node.origin?.attachment_assets) ? node.origin.attachment_assets : []) {
      try { pastedAssets.push(validateImageAssetName(rawName)); } catch {}
      if (pastedAssets.length === MAX_ASK_ATTACHMENTS) break;
    }
    if (pastedAssets.length) {
      const attachments = [];
      for (const name of pastedAssets) {
        try {
          const blob = await this.store.getAsset(this.holeId, name);
          if (blob) attachments.push({ kind: "image", data_url: await blobToDataUrl(blob), source: "pasted_image", name });
        } catch {}
      }
      if (attachments.length) context.attachments = attachments;
      return;
    }
  }

  createRun(node, fallbackTitle = fallbackTitleForNode(node)) {
    return new Run({
      id: this.mintRunId(),
      initialMarkdown: resetMarkdownForRun(node),
      fallbackTitle,
    });
  }

  async authorDocument(source, { onProgress = null } = {}) {
    const nodeId = this.state.root_id;
    const node = this.state.nodes.get(nodeId);
    if (!node || !this.provider) throw new Error("Document authoring requires a pending root and provider.");
    const controller = new AbortController();
    this.abortByNode.get(nodeId)?.abort();
    this.abortByNode.set(nodeId, controller);
    const run = this.createRun({ ...node, markdown: "" }, node.title || "Untitled");
    const generation = this.provider.authorDocument(source, controller.signal, { nodeId });
    try {
      for await (const docEvent of generationDocEvents(generation, run, {
        nodeId,
        progressFields: { base_url: node.base_url, base_url_source: node.base_url_source },
        answeredFields: () => rootAnsweredFields(this.state.nodes.get(nodeId)),
        beforeComplete: (activeRun) => {
          activeRun.accept({ type: "title", title: titleFromMarkdown(activeRun.snapshot().markdown) || node.title || "Untitled" });
        },
        complete: (activeRun, context) => ({
          ...activeRun.complete(context),
          // Authoring replaces its source, falling back to that source when the model returns no text.
          markdown: activeRun.snapshot().markdown.trim() || String(source.markdown || ""),
        }),
      })) {
        if (controller.signal.aborted || this.disposed) throw new DOMException("Aborted", "AbortError");
        this.dispatch(docEvent);
        if (docEvent.type === "node_progress") {
          onProgress?.(this.state.nodes.get(nodeId).markdown.length);
        }
      }
      this.title = this.state.nodes.get(nodeId).title;
      this.dispatch({ type: "hole_title", title: this.title });
      await this.flushSave();
      return holeStateToHole(this.state);
    } finally {
      this.saveChain.cancel();
      if (this.abortByNode.get(nodeId) === controller) this.abortByNode.delete(nodeId);
    }
  }

  handleAnswerError(nodeId, err, signal) {
    if (this.abortByNode.get(nodeId)?.signal === signal) this.abortByNode.delete(nodeId);
    if (signal?.aborted) return;
    const node = this.state.nodes.get(nodeId);
    if (!node || node.status !== "pending") return;
    const normalized = normalizeProviderError(err);
    if (normalized.code === "abort") return;
    const replacedNote = this.noteConversions.get(nodeId);
    if (replacedNote) {
      this.noteConversions.delete(nodeId);
      this.state.nodes.set(nodeId, replacedNote);
      this.emit({ type: "node_error", node_id: nodeId, message: normalized.message,
        code: normalized.code, retryable: false, restore_note: true });
      this.scheduleSave();
      return;
    }
    if (isAuthError(normalized)) {
      this.onAuthRequired?.({ node, error: normalized, retry: () => this.handleRetry({ node_id: nodeId }) });
    } else if (["network", "agent_signed_out", "agent_missing", "model_unknown", "model_no_images", "payload_too_large", "turn_failed", "web_search_failed", "conversation_unavailable", "conversation_invalid", "conversation_incomplete"].includes(normalized.code)) {
      this.onProviderFailure?.({
        node,
        error: normalized,
        retry: ({ withoutAttachment = false } = {}) => this.handleRetry({ node_id: nodeId, without_attachment: withoutAttachment }),
      });
    }
    this.emit({
      type: "node_error",
      node_id: nodeId,
      message: normalized.message,
      code: normalized.code,
      retryable: normalized.retryable,
      markdown: node.markdown || "",
    });
    this.scheduleSave();
  }

  dispatchProgress(nodeId, markdown, { emit = false } = {}) {
    const node = this.state.nodes.get(nodeId);
    if (!node || node.status !== "pending") return;
    // Deliberately untagged: this is a one-shot retry reset/replacement, not
    // generation progress, so Run ordering does not apply.
    this.dispatch({
      type: "node_progress",
      node_id: nodeId,
      markdown,
      base_url: node.base_url,
      base_url_source: node.base_url_source,
    });
    const current = this.state.nodes.get(nodeId);
    if (emit) {
      // This mirrors the deliberately untagged reset above to the local UI; it
      // is not a streamed generation event and must not claim a run identity.
      this.emit({
        type: "node_progress",
        node_id: nodeId,
        markdown: current.markdown,
        base_url: current.base_url,
        base_url_source: current.base_url_source,
      });
    }
    this.scheduleSave();
  }

  buildBranchContext(node) {
    const parent = this.state.nodes.get(node.parent_id ?? this.state.root_id);
    return {
      node_id: node.id,
      parent_id: parent?.id || null,
      parent_title: parent?.title || "Untitled",
      parent_markdown: parent?.markdown || "",
      selected_text: node.parent_id == null ? "" : (node.origin?.selected_text || ""),
      question: node.origin?.question || "",
      lens: node.origin?.lens || null,
      instruction: node.origin?.instruction || null,
      anchor: node.origin?.anchor || null,
    };
  }

}
