/** Browser generation events; the native bridge validates completion before the host binds a session. */

import type { NodeAnsweredEvent, NodeProgressEvent } from "./engine.js";

export interface TextGenerationEvent {
  type: "text";
  delta: string;
}

export interface TitleGenerationEvent {
  type: "title";
  title: string;
}

/** Live search lifecycle; hosts project it without persisting tool/session state. */
export interface SearchGenerationEvent {
  type: "search";
  id: string;
  status: "searching" | "completed";
  action?: string;
  query?: string;
}

/** A completed article association, separate from model text and tool progress. */
export interface ConversationGenerationEvent {
  type: "conversation";
  nodeId: string;
  conversation: import("../conversation.js").BackendConversation;
}

export type GenerationEvent = TextGenerationEvent | TitleGenerationEvent | SearchGenerationEvent | ConversationGenerationEvent;

/** Browser host generation surface. Product prompts belong to the bridge. */
export interface Provider {
  answerBranch(context: unknown, signal: AbortSignal): AsyncIterable<GenerationEvent>;
  authorExplainer(context: unknown, signal: AbortSignal): AsyncIterable<GenerationEvent>;
  authorDocument(source: unknown, signal: AbortSignal): AsyncIterable<GenerationEvent>;
}

export interface RunOptions {
  id: string;
  initialMarkdown?: string;
  fallbackTitle?: string;
}

export interface RunSnapshot {
  id: string;
  seq: number;
  markdown: string;
  title: string;
}

export interface ProgressDocContext {
  nodeId?: string;
  progressFields?: Record<string, unknown>;
}

export interface AnsweredDocContext {
  nodeId: string;
  answeredFields?: Record<string, unknown>;
}

export declare class Run {
  constructor(options: RunOptions);
  accept(event: TextGenerationEvent | TitleGenerationEvent, context?: ProgressDocContext): NodeProgressEvent | null;
  complete(context: AnsweredDocContext): NodeAnsweredEvent;
  snapshot(): RunSnapshot;
}
