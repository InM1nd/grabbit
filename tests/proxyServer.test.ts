import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLimit, DEFAULT_LIMITS, limitBody, MemoryStore, parseRoute, readLimits, secondsToReset } from '../server/lib/limits';

test('routes: only the app\'s Gemini calls are forwarded', () => {
  assert.deepEqual(parseRoute('POST', 'models/gemini-3.5-flash:generateContent'), { kind: 'generate', upstreamPath: 'models/gemini-3.5-flash:generateContent' });
  assert.equal(parseRoute('POST', 'v1beta/models/gemini-embedding-001:batchEmbedContents')?.kind, 'embed');
  assert.equal(parseRoute('GET', 'models')?.kind, 'models');
  assert.equal(parseRoute('POST', 'models/gemini-3.5-flash:streamGenerateContent'), null);
  assert.equal(parseRoute('POST', 'models/imagen-4:generateContent'), null);
  assert.equal(parseRoute('POST', 'models/gemini-embedding-001:generateContent'), null);
  assert.equal(parseRoute('GET', 'models/gemini-3.5-flash:generateContent'), null);
  assert.equal(parseRoute('POST', 'models/../files:generateContent'), null);
});

test('per-device daily limit, separate counters per device and kind', async () => {
  const store = new MemoryStore();
  const lim = { generatePerDevice: 3, embedPerDevice: 2, globalPerDay: 100 };
  const now = Date.UTC(2026, 9, 29, 12);
  for (let i = 0; i < 3; i++) assert.equal((await checkLimit(store, 'devA', 'generate', lim, now)).ok, true);
  const v = await checkLimit(store, 'devA', 'generate', lim, now);
  assert.equal(v.ok, false);
  if (!v.ok) { assert.equal(v.scope, 'device'); assert.equal(v.retryAfter, 12 * 3600); }
  assert.equal((await checkLimit(store, 'devB', 'generate', lim, now)).ok, true);
  assert.equal((await checkLimit(store, 'devA', 'embed', lim, now)).ok, true);
  assert.equal((await checkLimit(store, 'devA', 'models', lim, now)).ok, true);
  // next UTC day resets
  assert.equal((await checkLimit(store, 'devA', 'generate', lim, now + 13 * 3600_000)).ok, true);
});

test('global cap across devices', async () => {
  const store = new MemoryStore();
  const lim = { generatePerDevice: 50, embedPerDevice: 50, globalPerDay: 2 };
  assert.equal((await checkLimit(store, 'a', 'generate', lim)).ok, true);
  assert.equal((await checkLimit(store, 'b', 'generate', lim)).ok, true);
  const v = await checkLimit(store, 'c', 'generate', lim);
  assert.equal(v.ok, false);
  if (!v.ok) assert.equal(limitBody(v).error.reason, 'GRABBIT_LIMIT');
});

test('limits from env with sane defaults', () => {
  assert.deepEqual(readLimits({}), DEFAULT_LIMITS);
  assert.equal(readLimits({ LIMIT_GENERATE_PER_DEVICE: '10', LIMIT_GLOBAL_PER_DAY: 'x' }).generatePerDevice, 10);
  assert.equal(readLimits({ LIMIT_GLOBAL_PER_DAY: 'x' }).globalPerDay, DEFAULT_LIMITS.globalPerDay);
  assert.equal(secondsToReset(Date.UTC(2026, 0, 1, 23, 59, 30)), 30);
});
