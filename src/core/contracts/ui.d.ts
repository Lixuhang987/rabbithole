import type { HoleNode } from "./engine.d.ts";

export interface UiHostPort {
  post?(event: unknown): Promise<{ ok?: boolean }>;
  putAsset?(name: string, value: Blob): Promise<{ ok?: boolean }>;
  deleteAsset?(name: string): Promise<{ ok?: boolean }>;
  connect?(): void;
  refreshStatus?(): void;
  persistNode?(node: HoleNode): void;
  persistNodesBulk?(nodes: HoleNode[]): void;
  scheduleViewSave?(): void;
  start?(): void;
  flush?(): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

export interface UiCapabilities {
  loadMermaid?(): Promise<unknown> | unknown;
  exportSnapshot?(): Promise<void> | void;
  exportPortable?(): Promise<void> | void;
  settingsHostLabel?: string;
}

export interface RabbitholeUiRuntime {
  readonly disposed: boolean;
  flush(): Promise<void>;
  dispose(): Promise<void>;
}
