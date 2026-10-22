import { createModelSettings } from './model-settings.js';
/** @param {{onSettingsChange?: () => void, onBridgeState?: () => void, beforeRestart?: () => Promise<void>}} [options] */
export function createWebSettingsRuntime({ onSettingsChange, onBridgeState, beforeRestart } = {}) {
  return { controller: createModelSettings({ onSettingsChange, onBridgeState, beforeRestart }) };
}
