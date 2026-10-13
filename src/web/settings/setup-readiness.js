import { loadSettings } from './settings.js';
export function getGenerationSetupStatus(settings = loadSettings()) {
  const model = String(settings.model || '').trim();
  const reason = settings.backend !== 'codex' ? 'backend_unavailable' : !settings.token ? 'bridge_unpaired' : !model ? 'missing_model' : '';
  return { ready: !reason, reason, model };
}
