import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bad, buildEmbedBody, buildGenerateBody, clientIp, imageMime, MAX_IMAGE_BYTES, parseEmbed, parseGenerate } from '../server/lib/validate';
import { checkLimit, DEFAULT_LIMITS, MemoryStore } from '../server/lib/limits';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('base64');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]).toString('base64');
const GIF = Buffer.from('GIF89a......').toString('base64');
const body180 = (parts: any[], extra: any = {}) => ({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 2, maxOutputTokens: 99999 }, ...extra });
const code = (fn: () => unknown) => { try { fn(); return 0; } catch (e) { return e instanceof Bad ? e.status : -1; } };

test('app 1.8.0 analysis request is accepted and rebuilt with fixed settings', () => {
  const i = parseGenerate('gemini-3.5-flash-lite', body180([{ text: 'Опиши пост' }, { inlineData: { mimeType: 'image/gif', data: JPG } }]));
  assert.equal(i.image?.mimeType, 'image/jpeg'); // sniffed, not trusted
  const b: any = buildGenerateBody(i);
  assert.equal(b.generationConfig.temperature, 0.4);
  assert.equal(b.generationConfig.maxOutputTokens, 4096);
  assert.equal(b.generationConfig.responseMimeType, 'application/json');
  assert.equal(b.generationConfig.thinkingConfig, undefined);
  assert.equal(buildGenerateBody({ model: 'gemini-3.5-flash', prompt: 'x' }).generationConfig.thinkingConfig.thinkingLevel, 'low');
  assert.deepEqual(Object.keys(b), ['contents', 'generationConfig']);
});

test('analysis: model allowlist and no client-controlled extras', () => {
  assert.equal(code(() => parseGenerate('gemini-2.5-pro', body180([{ text: 'x' }]))), 400);
  assert.equal(code(() => parseGenerate('gemini-3.5-flash', body180([{ text: 'x' }], { tools: [{ googleSearch: {} }] }))), 400);
  assert.equal(code(() => parseGenerate('gemini-3.5-flash', body180([{ text: 'x' }], { systemInstruction: { parts: [{ text: 'y' }] } }))), 400);
  assert.equal(code(() => parseGenerate('gemini-3.5-flash', { contents: [{ role: 'model', parts: [{ text: 'x' }] }] })), 400);
  assert.equal(code(() => parseGenerate('gemini-3.5-flash', { contents: [{ parts: [{ text: 'x' }] }, { parts: [{ text: 'y' }] }] })), 400);
  assert.equal(code(() => parseGenerate('gemini-3.5-flash', body180([{ text: 'x' }, { fileData: { fileUri: 'gs://a' } }]))), 400);
  assert.equal(code(() => parseGenerate('gemini-3.5-flash', body180([{ text: 'x'.repeat(12_001) }]))), 413);
  assert.equal(code(() => parseGenerate('gemini-3.5-flash', body180([{ text: '  ' }]))), 400);
});

test('images: magic bytes and size cap', () => {
  assert.equal(imageMime(PNG), 'image/png');
  assert.equal(imageMime(JPG), 'image/jpeg');
  assert.equal(imageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 ').toString('base64')), 'image/webp');
  assert.equal(imageMime(GIF), null);
  assert.equal(imageMime('not base64!'), null);
  assert.equal(code(() => parseGenerate('gemini-3.5-flash', body180([{ text: 'x' }, { inlineData: { mimeType: 'image/gif', data: GIF } }]))), 400);
  const big = JPG + 'A'.repeat(Math.ceil(MAX_IMAGE_BYTES * 4 / 3));
  assert.equal(code(() => parseGenerate('gemini-3.5-flash', body180([{ text: 'x' }, { inlineData: { mimeType: 'image/jpeg', data: big } }]))), 413);
});

test('embeddings: 1.8.0 shape accepted, only gemini-embedding-001, fixed dimension', () => {
  const req = (text: string, extra: any = {}) => ({ model: 'models/gemini-embedding-001', content: { parts: [{ text }] }, taskType: 'RETRIEVAL_QUERY', outputDimensionality: 3072, ...extra });
  const e = parseEmbed('gemini-embedding-001', { requests: [req('a'), req('b')] });
  const b = buildEmbedBody(e);
  assert.equal(b.requests.length, 2);
  assert.equal(b.requests[0].outputDimensionality, 256);
  assert.equal(code(() => parseEmbed('text-embedding-004', { requests: [req('a')] })), 400);
  assert.equal(code(() => parseEmbed('gemini-embedding-001', { requests: [req('a', { model: 'models/other' })] })), 400);
  assert.equal(code(() => parseEmbed('gemini-embedding-001', { requests: [req('a', { taskType: 'CLASSIFICATION' })] })), 400);
  assert.equal(code(() => parseEmbed('gemini-embedding-001', { requests: Array.from({ length: 101 }, () => req('a')) })), 413);
  assert.equal(code(() => parseEmbed('gemini-embedding-001', { requests: [req('x'.repeat(8001))] })), 413);
});

test('per-IP burst and daily limits, global embed cap', async () => {
  const now = Date.UTC(2026, 9, 29, 12, 0, 10);
  const s = new MemoryStore(() => now);
  const lim = { ...DEFAULT_LIMITS, ipPerMinute: 3, ipPerDay: 5, globalEmbedPerDay: 100 };
  for (let i = 0; i < 3; i++) assert.equal((await checkLimit(s, `dev${i}xxxxxxxxxxxxxx`, 'generate', lim, now, '1.2.3.4')).ok, true);
  const b = await checkLimit(s, 'devZxxxxxxxxxxxxxxx', 'embed', lim, now, '1.2.3.4');
  assert.equal(b.ok, false); if (!b.ok) { assert.equal(b.scope, 'burst'); assert.equal(b.retryAfter, 50); }
  assert.equal((await checkLimit(s, 'devZxxxxxxxxxxxxxxx', 'embed', lim, now, '5.6.7.8')).ok, true);
  // next minutes: daily IP cap kicks in after 5 counted requests (the burst-rejected one isn't counted per day)
  const later = [now + 60_000, now + 120_000];
  assert.equal((await checkLimit(s, 'devA', 'generate', lim, later[0], '1.2.3.4')).ok, true);
  assert.equal((await checkLimit(s, 'devA', 'generate', lim, later[0], '1.2.3.4')).ok, true);
  const d = await checkLimit(s, 'devA', 'generate', lim, later[1], '1.2.3.4');
  assert.equal(d.ok, false); if (!d.ok) assert.equal(d.scope, 'ip');
  const g = new MemoryStore();
  const lim2 = { ...DEFAULT_LIMITS, globalEmbedPerDay: 2 };
  assert.equal((await checkLimit(g, 'a', 'embed', lim2, now, 'a')).ok, true);
  assert.equal((await checkLimit(g, 'b', 'embed', lim2, now, 'b')).ok, true);
  const v = await checkLimit(g, 'c', 'embed', lim2, now, 'c');
  assert.equal(v.ok, false); if (!v.ok) assert.equal(v.scope, 'global');
});

test('client IP comes from the edge headers', () => {
  const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
  assert.equal(clientIp(h({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' })), '9.9.9.9');
  assert.equal(clientIp(h({ 'x-real-ip': '2001:db8::1' })), '2001:db8::1');
  assert.equal(clientIp(h({ 'x-forwarded-for': '<script>' })), 'unknown');
});
