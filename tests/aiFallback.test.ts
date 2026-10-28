import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzePost, GEMINI_MODELS, _resetAiState } from '../src/core/ai';

const meta: any = { url: 'https://example.com', platform: 'web', title: 'Example', description: 'Example site' };
const ok = (o: any) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] }, finishReason: 'STOP' }] }), { status: 200 });

function mock(handlers: ((model: string) => Response)[]) {
  const seen: string[] = [];
  let i = 0;
  (globalThis as any).fetch = async (url: string) => {
    if (!url.includes(':generateContent')) return new Response('{}', { status: 500 }); // model list unavailable
    const m = url.match(/models\/([^:]+)/)![1];
    seen.push(m);
    return handlers[Math.min(i++, handlers.length - 1)](m);
  };
  return seen;
}

test('garbled / empty answer falls through to next model', async () => {
  _resetAiState();
  const seen = mock([
    () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"title":"x","summ' }] }, finishReason: 'MAX_TOKENS' }] })),
    () => ok({ title: 'T', summary: '', tags: [], board: 'Разное' }),
    () => ok({ title: 'Good', summary: 'A proper summary of the post.', tags: ['a'], board: 'Разное' }),
  ]);
  const r = await analyzePost({ meta, boards: ['Разное'] } as any, 'k');
  assert.equal(r.title, 'Good');
  assert.equal(seen.length, 3);
});

test('429 puts model on cooldown for the next call', async () => {
  _resetAiState();
  let seen = mock([
    () => new Response(JSON.stringify({ error: { message: 'quota', details: [{ retryDelay: '30s' }] } }), { status: 429 }),
    () => ok({ title: 'T', summary: 'A proper summary of the post.', tags: ['a'], board: 'Разное' }),
  ]);
  await analyzePost({ meta, boards: ['Разное'] } as any, 'k');
  assert.deepEqual(seen, [GEMINI_MODELS[0], GEMINI_MODELS[1]]);
  seen = mock([() => ok({ title: 'T', summary: 'A proper summary of the post.', tags: ['a'], board: 'Разное' })]);
  await analyzePost({ meta, boards: ['Разное'] } as any, 'k');
  assert.deepEqual(seen, [GEMINI_MODELS[1]]);
});

test('503 everywhere gets a second pass before failing', async () => {
  _resetAiState();
  let n = 0;
  const seen = mock([(m) => (++n <= GEMINI_MODELS.length ? new Response('{}', { status: 503 }) : ok({ title: 'T', summary: 'A proper summary of the post.', tags: [], board: 'Разное' }))]);
  const r = await analyzePost({ meta, boards: ['Разное'] } as any, 'k');
  assert.equal(r.summary, 'A proper summary of the post.');
  assert.equal(seen.length, GEMINI_MODELS.length + 1);
});
