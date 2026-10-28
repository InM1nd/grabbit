// @ts-nocheck
// Bench the app's real analyzePost against live Gemini. Usage: npx tsx scripts/ai-bench.mts [--per-model N] [--chain N] [--out file]
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import * as ai from '../src/core/ai.ts';
import { fetchMetadata } from '../src/core/metadata.ts';
import { normalizeUrl } from '../src/core/url.ts';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PER = Number(arg('--per-model', 10)), CHAIN = Number(arg('--chain', 20)), OUT = arg('--out', '/tmp/bench.json');
const KEY = process.env.GEMINI_API_KEY;
const URLS = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://www.tiktok.com/@scout2015/video/6718335390845095173',
  'https://www.instagram.com/reel/DdBtNAvhuoP/',
  'https://github.com/expo/expo',
  'https://www.instagram.com/reel/DdO-IIyioOy/', // private: opaque
];
const BOARDS = ['ИИ-инструменты', 'Программирование', 'Гаджеты', 'Разное', 'Музыка'];

const metaCache = '/tmp/bench-meta.json';
let metas = existsSync(metaCache) ? JSON.parse(readFileSync(metaCache, 'utf8')) : null;
if (!metas) { metas = []; for (const u of URLS) metas.push(await fetchMetadata(normalizeUrl(u))); writeFileSync(metaCache, JSON.stringify(metas)); }

// instrument fetch: record every Gemini HTTP call
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).includes('generativelanguage')) return realFetch(url, init);
  const t0 = Date.now(); const model = String(url).match(/models\/([^:]+)/)?.[1];
  const INJ = Number(process.env.INJECT_503 || 0); // fault injection: fake transient 503s
  if (INJ && String(url).includes(':generateContent') && Math.random() < INJ) { calls.push({ model, status: '503*', ms: 0 }); return new Response('{"error":{"message":"injected 503"}}', { status: 503 }); }
  try {
    const r = await realFetch(url, init); const txt = await r.text(); const ms = Date.now() - t0;
    let finish = null, usage = null, outLen = 0;
    try { const j = JSON.parse(txt); finish = j.candidates?.[0]?.finishReason ?? null; usage = j.usageMetadata ?? null; outLen = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').length; } catch {}
    calls.push({ model, status: r.status, ms, finish, outLen, thoughts: usage?.thoughtsTokenCount ?? 0, cand: usage?.candidatesTokenCount ?? 0 });
    return new Response(txt, { status: r.status, headers: r.headers });
  } catch (e) { calls.push({ model, status: e?.name === 'AbortError' ? 'timeout' : 'neterr', ms: Date.now() - t0 }); throw e; }
};

function quality(res) {
  if (!res) return 'fail';
  if (!res.summary || res.summary.length < 15) return 'empty-summary';
  if (!res.tags?.length) return 'no-tags';
  if (!res.title) return 'no-title';
  return 'ok';
}

async function run(models, n, label) {
  const orig = [...ai.GEMINI_MODELS];
  if (models) ai.GEMINI_MODELS.splice(0, ai.GEMINI_MODELS.length, ...models);
  ai._resetAiState?.();
  const rows = [];
  for (let i = 0; i < n; i++) {
    const meta = metas[i % metas.length];
    const before = calls.length; const t0 = Date.now(); let res = null, err = null;
    try { res = await ai.analyzePost({ meta, sharedText: '', boards: BOARDS, lang: 'ru' }, KEY); } catch (e) { err = String(e?.message || e).slice(0, 120); }
    rows.push({ label, url: meta.url, res, ms: Date.now() - t0, q: err ? 'error' : quality(res), err, model: res?.model, calls: calls.slice(before) });
    process.stdout.write(err ? 'E' : quality(res) === 'ok' ? '.' : 'q');
  }
  ai.GEMINI_MODELS.splice(0, ai.GEMINI_MODELS.length, ...orig);
  process.stdout.write(` ${label}\n`);
  return rows;
}

const all = [];
const LIST = arg('--models', '') ? arg('--models').split(',') : [...ai.GEMINI_MODELS];
if (PER > 0) for (const m of LIST) all.push(...await run([m], PER, m));
if (CHAIN > 0) all.push(...await run(null, CHAIN, 'chain'));
writeFileSync(OUT, JSON.stringify(all, null, 1));

const groups = {};
for (const r of all) (groups[r.label] ||= []).push(r);
for (const [k, rs] of Object.entries(groups)) {
  const ok = rs.filter((r) => r.q === 'ok').length;
  const st = {}; for (const r of rs) for (const c of r.calls) st[`${c.model}:${c.status}${c.finish && c.finish !== 'STOP' ? '/' + c.finish : ''}`] = (st[`${c.model}:${c.status}${c.finish && c.finish !== 'STOP' ? '/' + c.finish : ''}`] || 0) + 1;
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  const q = {}; for (const r of rs) q[r.q] = (q[r.q] || 0) + 1;
  const errs = [...new Set(rs.filter((r) => r.err).map((r) => r.err))].slice(0, 4);
  console.log(`${k}: ok ${ok}/${rs.length}  p50 ${ms[ms.length >> 1]}ms  max ${ms.at(-1)}ms  quality ${JSON.stringify(q)}\n   http ${JSON.stringify(st)}${errs.length ? '\n   errors ' + JSON.stringify(errs) : ''}`);
}
