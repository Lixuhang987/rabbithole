/** @protects complete semantic Ask input, images, visual sources and PDF transcription. */
import assert from 'node:assert/strict';
import { buildExplainerInput } from '../../src/core/prompts/explainer-v1.js';
import { buildAnswerInput, selectedVisualSource } from '../../src/core/prompts/answering-v1.js';
import { buildTranscribeInput, TRANSCRIBE_V1_RULES } from '../../src/core/prompts/transcribe-v1.js';
const context = { article: { title: 'Parent', markdown: 'Body' }, selected_text: 'x', question: 'Why?', lens: null };
const plain = buildAnswerInput(context);
assert.equal(buildAnswerInput(structuredClone(context)).text, plain.text);
assert.match(plain.text, /Source article:\nBody/);
const image = 'data:image/jpeg;base64,/9j/2Q==';
const withImage = buildAnswerInput({ ...context, attachments: [{ data_url: image, source: 'selection_crop' }] });
assert.deepEqual(withImage.images, [image]);
assert.match(withImage.text, /Selection region images are attached/);
assert.equal(buildAnswerInput(context).text, plain.text);
const styled = buildAnswerInput({ ...context, question: 'Focus on the failure mode.', lens: 'deeper', instruction: 'Use a systems lens.' });
assert.match(styled.text, /Preset instruction:\nUse a systems lens\.[\s\S]*Human question:\nFocus on the failure mode\./);
const fork = buildAnswerInput({ ...context, visual_source: '```show id=selected\n<div>one</div>\n```' }, { fork: true });
assert.match(fork.text, /Selected visual source:/);
const longBody = `START ${'p'.repeat(60000)} TAIL`;
assert.ok(buildAnswerInput({ ...context, article: { markdown: longBody } }).text.includes(longBody));
assert.equal(selectedVisualSource('```show id=selected\n<div>one</div>\n```', 'selected'), '```show id=selected\n<div>one</div>\n```');
const pasted = buildAnswerInput({ ...context, attachments: [{ data_url: image, source: 'pasted_image' }] });
assert.match(pasted.text, /Pasted images are attached/);
const transcription = buildTranscribeInput({ pages: [{ n: 7, data_url: image }], tail: 'x'.repeat(700) });
assert.deepEqual(transcription.images, [image]);
for (const rule of [/GitHub-flavored Markdown/, /LaTeX/, /GFM tables/, /figure:page-NNN:x,y,w,h/, /running headers/, /no TITLE sentinel/i]) assert.match(TRANSCRIBE_V1_RULES, rule);
assert.ok(transcription.text.includes('x'.repeat(500)));
assert.ok(!transcription.text.includes('x'.repeat(501)));

for (const instructions of [plain.instructions, buildExplainerInput({ question: 'Why?' }).instructions]) {
  assert.match(instructions, /Explain the mechanisms, reasoning, or evidence essential to the current question/);
  assert.match(instructions, /unfamiliar concepts and the questions they raise are valuable entry points/);
  assert.doesNotMatch(instructions, /Distinguish between levels of understanding/);
}
