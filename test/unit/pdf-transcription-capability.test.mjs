/** @protects selected-model PDF vision discovery through the bridge. */
import assert from 'node:assert/strict';
import { pdfTranscriptionCapability, detectPdfTranscriptionCapability } from '../../src/web/provider/pdf-transcription.js';
const settings = { backend: 'codex', model: 'vision', token: 'paired', base_url: 'http://127.0.0.1:41414' };
assert.equal(pdfTranscriptionCapability({ ...settings, model: '' }).status, 'model_required');
assert.equal(pdfTranscriptionCapability(settings).status, 'checking');
assert.equal(pdfTranscriptionCapability(settings, { models: [{ id: 'vision', images: true }] }).available, true);
assert.equal(pdfTranscriptionCapability(settings, { models: [{ id: 'vision', images: false }] }).status, 'no_vision');
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `${settings.base_url}/bridge/models`);
    assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer paired');
    return Response.json({ models: [{ id: 'vision', images: true }] });
  };
  assert.equal((await detectPdfTranscriptionCapability(settings)).model, settings.model);
  assert.equal((await detectPdfTranscriptionCapability(settings)).available, true);
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.equal((await detectPdfTranscriptionCapability(settings)).status, 'unverified');
} finally { globalThis.fetch = originalFetch; }
