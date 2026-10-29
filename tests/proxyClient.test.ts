import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canUseGemini, geminiTarget, newDeviceId, proxyLimitInfo } from '../src/core/gemini';
import { analyzePost, AiError, _resetAiState } from '../src/core/ai';
import { embedTexts } from '../src/core/embed';

const proxy = { proxyUrl: 'https://p.example.com/', deviceId: 'dev-1234567890abcdef' };

test('own key goes direct, otherwise proxy with device id', () => {
  const own = geminiTarget({ ...proxy, key: 'K' }, 'models/m:generateContent')!;
  assert.match(own.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/m:generateContent$/);
  assert.deepEqual(own.headers, { 'x-goog-api-key': 'K' });
  const p = geminiTarget(proxy, 'models/m:generateContent')!;
  assert.equal(p.url, 'https://p.example.com/v1beta/models/m:generateContent');
  assert.deepEqual(p.headers, { 'x-device-id': proxy.deviceId });
  assert.equal(geminiTarget({ proxyUrl: 'x' }, 'models'), null);
  assert.equal(canUseGemini({}), false);
  assert.equal(canUseGemini('k'), true);
});

test('device id looks like a uuid v4 and is unique', () => {
  const a = newDeviceId(), b = newDeviceId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

test('proxy 429 is told apart from Gemini quota 429', () => {
  assert.deepEqual(proxyLimitInfo(429, JSON.stringify({ error: { reason: 'GRABBIT_LIMIT', scope: 'device', retryAfterSec: 99 } })), { scope: 'device', retryAfterSec: 99 });
  assert.equal(proxyLimitInfo(429, JSON.stringify({ error: { message: 'quota' } })), null);
  assert.equal(proxyLimitInfo(500, '{}'), null);
});

test('analyzePost stops on proxy limit without trying other models', async () => {
  _resetAiState();
  const urls: string[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    urls.push(url);
    assert.equal(init.headers['x-device-id'], proxy.deviceId);
    assert.equal(init.headers['x-goog-api-key'], undefined);
    if (!url.includes(':generateContent')) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify({ error: { reason: 'GRABBIT_LIMIT', scope: 'device', retryAfterSec: 60, message: 'limit' } }), { status: 429 });
  };
  await assert.rejects(analyzePost({ meta: { url: 'https://e.com', platform: 'web', title: 'T' }, boards: [] } as any, proxy), (e: any) => e instanceof AiError && e.limit?.scope === 'device');
  assert.equal(urls.filter((u) => u.includes(':generateContent')).length, 1);
  assert.ok(urls.every((u) => u.startsWith('https://p.example.com/v1beta/')));
});

test('embeddings go through the proxy', async () => {
  let seen = '';
  (globalThis as any).fetch = async (url: string) => {
    seen = url;
    return new Response(JSON.stringify({ embeddings: [{ values: Array(256).fill(1) }] }), { status: 200 });
  };
  const [v] = await embedTexts(['hi'], proxy, 'RETRIEVAL_QUERY');
  assert.match(seen, /^https:\/\/p\.example\.com\/v1beta\/models\/.+:batchEmbedContents$/);
  assert.ok(v.length > 0);
});
