import { normalizeBackendConversation } from '../../core/conversation.js';
import { buildAnswerInput } from '../../core/prompts/answering-v1.js';
import { buildAuthorInput } from '../../core/prompts/authoring-v1.js';
import { buildExplainerInput } from '../../core/prompts/explainer-v1.js';
import { buildTranscribeInput } from '../../core/prompts/transcribe-v1.js';
import { BridgeError } from './errors.js';

function invalid(message) { throw new BridgeError(message, 'input_invalid', 400); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function string(value, name, required = false) {
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || (required && !value.trim())) invalid(`Invalid ${name}.`);
}
function fields(value, allowed) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid('Unexpected request field.');
}
/** Validate semantic task input before touching native history. */
export function generationRequest(body) {
  if (!object(body)) invalid('Request must be a JSON object.');
  fields(body, ['backend', 'model', 'reasoning', 'sourceSession', 'input']);
  if (body.backend !== 'codex') throw new BridgeError('This backend is not implemented.', 'backend_unavailable', 400);
  string(body.model, 'model', true);
  string(body.reasoning, 'reasoning');
  let sourceSession;
  if (body.sourceSession !== undefined) {
    sourceSession = normalizeBackendConversation(body.sourceSession);
    if (!sourceSession) invalid('Invalid source session.');
    fields(body.sourceSession, ['backend', 'sessionId', 'scopeId']);
    if (sourceSession.backend !== body.backend) throw new BridgeError('Source session belongs to another backend.', 'backend_mismatch', 409);
  }
  const value = body.input;
  if (!object(value)) invalid('Task input is required.');
  let prepared;
  switch (value.kind) {
    case 'explain':
      fields(value, ['kind', 'question']); string(value.question, 'question', true);
      prepared = buildExplainerInput(value); break;
    case 'author':
      fields(value, ['kind', 'source']);
      if (!object(value.source)) invalid('Document source is required.');
      fields(value.source, ['title', 'markdown', 'source_name', 'kind', 'base_url']);
      string(value.source.markdown, 'source markdown', true);
      for (const key of ['title', 'source_name', 'kind', 'base_url']) string(value.source[key], key);
      prepared = buildAuthorInput(value.source); break;
    case 'ask':
      fields(value, ['kind', 'article', 'question', 'selected_text', 'lens', 'instruction', 'visual_source', 'attachments']);
      for (const key of ['question', 'selected_text', 'lens', 'instruction', 'visual_source']) string(value[key], key);
      if (!['question', 'selected_text', 'lens', 'instruction', 'visual_source'].some((key) => value[key]?.trim())
        && !value.attachments?.length) invalid('An Ask needs a question, selection, preset or image.');
      if (sourceSession && value.article !== undefined) invalid('A fork cannot also reconstruct its source article.');
      if (value.article !== undefined) {
        if (!object(value.article)) invalid('Invalid article.');
        fields(value.article, ['title', 'markdown']);
        string(value.article.title, 'article title'); string(value.article.markdown, 'article body', true);
      }
      if (value.attachments !== undefined) {
        if (!Array.isArray(value.attachments) || value.attachments.length > 4) invalid('Invalid Ask attachments.');
        for (const image of value.attachments) {
          if (!object(image) || image.kind !== 'image') invalid('Invalid image attachment.');
          fields(image, ['kind', 'data_url', 'source', 'name', 'page']);
          string(image.data_url, 'image data', true); string(image.source, 'image source'); string(image.name, 'image name');
        }
      }
      prepared = buildAnswerInput(value, { fork: !!sourceSession }); break;
    case 'transcribe':
      fields(value, ['kind', 'pages', 'tail']); string(value.tail, 'tail');
      if (!Array.isArray(value.pages) || !value.pages.length) invalid('PDF pages are required.');
      for (const page of value.pages) {
        if (!object(page) || !Number.isInteger(page.n) || page.n < 1) invalid('Invalid PDF page.');
        fields(page, ['n', 'data_url']); string(page.data_url, 'page image', true);
      }
      prepared = buildTranscribeInput(value); break;
    default: invalid('Unknown generation task.');
  }
  if (sourceSession && value.kind !== 'ask') invalid('Only article Asks can fork a source session.');
  const images = prepared.images.map((url) => {
    if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) invalid('Images must use embedded base64 data URLs.');
    return { type: 'image', url, detail: 'auto' };
  });
  return { backend: body.backend, model: body.model, reasoning: body.reasoning, sourceSession,
    instructions: prepared.instructions, input: [{ type: 'text', text: prepared.text }, ...images] };
}
