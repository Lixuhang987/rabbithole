import { createModelSettings } from './model-settings.js';
/** @param {{onSettingsChange?: () => void}} [options] */
export function createWebSettingsRuntime({ onSettingsChange } = {}) {
  return { controller: createModelSettings({ onSettingsChange }) };
}
