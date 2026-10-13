import { addressSpaceHint } from './network.js';
export const PDF_TRANSCRIPTION_HELP = 'Uses your selected model to turn PDF pages into searchable Markdown.';
export function pdfTranscriptionCapability(settings, { models = null, discoveryError = false } = {}) {
  const model = String(settings.model || '');
  if (!model || !settings.token) return { available: false, model, status: 'model_required', reason: 'Connect Codex and choose a model in Model settings.' };
  const entry = models?.find((value) => value.id === model);
  const available = entry?.images === true || entry?.vision === true;
  return { available, model, status: available ? 'available' : discoveryError ? 'unverified' : models ? 'no_vision' : 'checking',
    reason: available ? '' : discoveryError ? 'Could not verify model vision support. Check the bridge connection.' : models ? 'The selected model does not support PDF images. Choose a vision model.' : 'Checking model vision support…' };
}
/** @param {any} settings @param {{signal?: AbortSignal}} [options] */
export async function detectPdfTranscriptionCapability(settings, { signal } = {}) {
  if (!settings.token || !settings.model) return pdfTranscriptionCapability(settings);
  const url = `${String(settings.base_url || '').replace(/\/+$/, '')}/bridge/models`;
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${settings.token}` }, signal, ...addressSpaceHint(url) });
    if (!response.ok) throw new Error('Model discovery failed');
    const { models } = await response.json();
    if (!Array.isArray(models)) throw new Error('Invalid model catalog');
    return pdfTranscriptionCapability(settings, { models });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return pdfTranscriptionCapability(settings, { discoveryError: true });
  }
}
