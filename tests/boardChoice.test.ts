// Board choice (1.10.1): prompt content and size, when the preview image is sent, the new-board threshold
// and the centered embedding fallback. Live Gemini is never called here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardLines, buildPrompt, isWeakText, PROMPT_BUDGET, shouldSendImage, stripPlatformNoise } from '../src/core/ai';
import { BOARD_HINTS, DEFAULT_BOARDS } from '../src/core/boards';
import { centroid, EMBED_PICK, MIN_CANDIDATES_FOR_CENTERING, NEW_BOARD_MIN_CONFIDENCE, pickBoard, pickBoardByEmbedding, prepareBoardVectors, resolveBoard, type AiBoard, type BoardVector } from '../src/core/sorting';
import { normalize } from '../src/core/embed';
import type { Metadata } from '../src/core/types';

const meta = (o: Partial<Metadata> = {}): Metadata => ({ url: 'https://www.instagram.com/reel/abc/', platform: 'instagram', source: 'test', ...o });
const defaults = (): AiBoard[] => Object.entries(DEFAULT_BOARDS).map(([key, v], i) => ({ id: i + 1, name: v.ru, key, tags: key === 'misc' ? [] : ['тег'] }));

// ---------- prompt ----------

test('prompt: default boards carry a hint, Misc is last and marked as the fallback', () => {
  const lines = boardLines(defaults());
  assert.equal(lines.length, Object.keys(DEFAULT_BOARDS).length);
  assert.match(lines[lines.length - 1], /"Разное"/);
  assert.ok(lines[lines.length - 1].includes('запасной вариант'));
  assert.ok(lines.find((l) => l.includes('ИИ-инструменты'))!.includes('ChatGPT'));
  // misc is first by id in the database, but must not be first for the model
  const misc = { id: 1, name: 'Разное', key: 'misc' };
  const out = boardLines([misc, { id: 2, name: 'Рецепты' }]);
  assert.ok(out[0].includes('Рецепты') && out[1].includes('Разное'));
});

test('prompt: a custom board is described by recent post titles and tags, not renamed', () => {
  const [line] = boardLines([{ id: 7, name: 'Мои штуки', tags: ['борщ', 'паста'], samples: ['Борщ за 30 минут', 'Паста карбонара'] }]);
  assert.ok(line.includes('"Мои штуки"'));
  assert.ok(line.includes('«Борщ за 30 минут»') && line.includes('борщ, паста'));
});

test('prompt: detail shrinks to fit the budget but Misc keeps its note', () => {
  const many: AiBoard[] = Array.from({ length: 60 }, (_, i) => ({ id: i + 2, name: 'Доска номер ' + i, tags: ['один', 'два', 'три', 'четыре', 'пять'], samples: ['Заголовок поста про что-то интересное', 'Ещё один заголовок'] }));
  const lines = boardLines([{ id: 1, name: 'Разное', key: 'misc' }, ...many], 3800);
  assert.ok(lines.join('\n').length <= 3800);
  assert.ok(lines[lines.length - 1].includes('запасной вариант'));
});

test('prompt: explains confidence, has examples, and says a clear topic means "new", not Misc', () => {
  const p = buildPrompt({ meta: meta(), boards: defaults() });
  assert.ok(p.includes('Примеры решений:'));
  assert.ok(p.includes('ясна ли тема'));
  assert.ok(p.includes('Ясная тема без подходящей доски — это "new"'));
  assert.ok(p.includes('Ссылка: https://www.instagram.com/reel/abc/'));
});

test('prompt: worst case stays under the budget (proxy rejects > 12 000 chars)', () => {
  const boards: AiBoard[] = [{ id: 1, name: 'Разное', key: 'misc' }, ...Array.from({ length: 79 }, (_, i) => ({ id: i + 2, name: 'Очень длинное название доски ' + i, tags: ['тег-один', 'тег-два', 'тег-три', 'тег-четыре', 'тег-пять'], samples: ['Заголовок первого поста на этой доске', 'Заголовок второго поста'] }))];
  const p = buildPrompt({
    meta: meta({ title: 'т'.repeat(300), author: '@' + 'a'.repeat(100), description: 'слово '.repeat(1000) }),
    sharedText: 'ш'.repeat(5000), note: 'з'.repeat(5000), boards, image: { mimeType: 'image/jpeg', data: 'x' }, lang: 'ru', boardLang: 'uk',
  });
  assert.ok(p.length <= PROMPT_BUDGET, `prompt is ${p.length} chars`);
  // the caption gives way first, the user's note is kept
  assert.ok(p.includes('з'.repeat(1000)));
});

test('prompt: a typical post keeps its whole caption', () => {
  const desc = 'Подробный разбор расширений для редактора. '.repeat(40);
  const p = buildPrompt({ meta: meta({ description: desc }), boards: defaults() });
  assert.ok(p.includes(desc.trim().slice(0, 1500)));
  assert.ok(p.length < 6000, `prompt is ${p.length} chars`);
});

// ---------- when the picture is sent ----------

test('weak text: platform counters and labels do not make a thin caption look informative', () => {
  const ig = '12.3K likes, 456 comments - some_user on October 1, 2026: "🔥 смотри до конца". ';
  assert.equal(stripPlatformNoise(ig).includes('likes'), false);
  assert.equal(isWeakText(meta({ description: ig })), true);
  assert.equal(isWeakText(meta({ description: '1,204 views · Instagram reel by @someone' })), true);
  assert.equal(isWeakText(meta({ description: '#fyp #viral 🔥🔥' })), true);
  const real = '12 likes, 3 comments - dev_user on October 1, 2026: "Пять расширений VS Code, которые экономят мне час каждый день при работе с React и TypeScript".';
  assert.equal(isWeakText(meta({ description: real })), false);
});

test('weak text: Russian counters and labels are stripped too (\\b is ASCII-only in JS)', () => {
  const ru = stripPlatformNoise('1 234 отметок «Нравится», 56 комментариев - user, 1 октября 2026 г.: «🔥 смотри до конца» 7,8K просмотров, 12 лайков, видео');
  for (const w of ['лайк', 'комментар', 'отмет', 'просмотр', 'видео']) assert.equal(ru.includes(w), false, `"${w}" left in: ${ru}`);
  assert.ok(ru.includes('смотри до конца'));
  const rich = '12 лайков - dev_user: «Пять расширений VS Code, которые экономят мне час каждый день при работе с React и TypeScript»';
  assert.equal(isWeakText(meta({ description: rich })), false);
});

test('image is sent for screenshots and thin captions, never without a picture or when vision is off', () => {
  const weak = meta({ description: '🔥 смотри' });
  const rich = meta({ description: 'Подробный текст поста про настройку редактора кода, плагины, темы, шрифты и горячие клавиши для работы.' });
  assert.equal(shouldSendImage({ hasImage: true, aiVision: true, meta: weak }), true);
  assert.equal(shouldSendImage({ hasImage: true, aiVision: true, meta: rich }), false);
  assert.equal(shouldSendImage({ hasImage: true, shot: true, aiVision: false, meta: rich }), true);
  assert.equal(shouldSendImage({ hasImage: true, aiVision: false, meta: weak }), false);
  assert.equal(shouldSendImage({ hasImage: false, shot: true, aiVision: true, meta: weak }), false);
  // a note from the user counts as text: no picture needed when it is detailed
  assert.equal(shouldSendImage({ hasImage: true, aiVision: true, meta: weak, note: 'Подборка плагинов для настройки редактора кода и терминала под веб-разработку' }), false);
});

// ---------- answer → board ----------

const boards: AiBoard[] = [{ id: 1, name: 'AI tools', key: 'ai-tools' }, { id: 2, name: 'Рецепты' }, { id: 3, name: 'Misc', key: 'misc' }];
const nb = { ru: 'Путешествия', en: 'Travel', uk: 'Подорожі' };

test('new board: a clear topic at 0.6 creates it, a guess below does not', () => {
  assert.equal(NEW_BOARD_MIN_CONFIDENCE, 0.6);
  assert.equal(resolveBoard({ boardId: 'new', newBoard: nb, confidence: 0.6 }, boards, 'ru').kind, 'new');
  assert.equal(resolveBoard({ boardId: 'new', newBoard: nb, confidence: 0.55 }, boards, 'ru').kind, 'misc');
});

test('explicit "misc"/"none" ids mean Misc; an unknown numeric id with a good name still finds the board', () => {
  for (const id of ['misc', 'none', 'Разное', '0']) assert.equal(resolveBoard({ boardId: id, confidence: 0.9 }, boards, 'ru').kind, 'misc');
  assert.deepEqual(resolveBoard({ boardId: '42', board: 'Рецепты', confidence: 0.8 }, boards, 'ru'), { kind: 'existing', id: 2, confidence: 0.8 });
});

// ---------- embeddings ----------
// Synthetic stand-in for gemini-embedding-001: every vector = big shared component + small topic part + noise.
// Parameters reproduce what was measured live on 2026-10-30 (raw cosines 0.84–0.96, right board leads by ~0.04,
// unrelated posts lead by ~0.005). It shows that centering widens the gap; it does NOT prove the thresholds for real data.

function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function world(seed: number, nTopics: number, kind: 'centroid' | 'name') {
  const r = rng(seed), D = 256;
  const gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const unit = () => normalize(Array.from({ length: D }, gauss));
  const common = unit();
  const topics = Array.from({ length: nTopics + 3 }, unit); // the last 3 have no board
  const mk = (t: number[], [a2, b2, n2]: number[], mix?: number[]) => {
    const e = unit();
    return normalize(common.map((c, i) => Math.sqrt(a2) * c + Math.sqrt(b2) * (mix ? 0.8 * t[i] + 0.6 * mix[i] : t[i]) + Math.sqrt(n2) * e[i]));
  };
  const post = [0.85, 0.06, 0.09], name = [0.8, 0.08, 0.12];
  const cands: BoardVector[] = topics.slice(0, nTopics).map((t, id) =>
    kind === 'centroid' ? { id, kind, vec: centroid(Array.from({ length: 5 }, () => mk(t, post)))! } : { id, kind, vec: mk(t, name) });
  return { cands, onTopic: (i: number) => mk(topics[i % nTopics], post, i % 3 === 0 ? topics[(i + 1) % nTopics] : undefined), offTopic: (i: number) => mk(topics[nTopics + (i % 3)], post) };
}

function score(kind: 'centroid' | 'name', centered: boolean) {
  let right = 0, wrong = 0, off = 0, n = 0;
  for (let seed = 1; seed <= 6; seed++) {
    const w = world(seed * 13, 6, kind);
    const prep = centered ? prepareBoardVectors(w.cands) : { cands: w.cands.map((c) => ({ ...c, vec: normalize(c.vec) })), centered: false, mean: null };
    assert.equal(prep.centered, centered);
    for (let i = 0; i < 120; i++, n++) {
      const p = pickBoard(w.onTopic(i), prep, centered ? undefined : EMBED_PICK);
      if (p) (p.id === i % 6 ? right++ : wrong++);
      if (pickBoard(w.offTopic(i), prep, centered ? undefined : EMBED_PICK)) off++;
    }
  }
  return { right: right / n, wrong: wrong / n, off: off / n };
}

test('embeddings: centering lets clearly matching posts through where raw cosines could not', () => {
  for (const kind of ['centroid', 'name'] as const) {
    const old = score(kind, false), now = score(kind, true);
    assert.ok(now.right >= old.right + 0.1, `${kind}: right ${old.right.toFixed(2)} → ${now.right.toFixed(2)}`);
    assert.ok(now.right >= (kind === 'centroid' ? 0.85 : 0.7), `${kind}: right ${now.right.toFixed(2)}`);
    assert.ok(now.wrong <= 0.02, `${kind}: wrong ${now.wrong.toFixed(2)}`);
    assert.ok(now.off <= 0.03, `${kind}: off-topic accepted ${now.off.toFixed(2)}`);
  }
});

test('embeddings: with fewer than 4 boards the raw rule is used (a "mean board" would erase the signal)', () => {
  const w = world(5, MIN_CANDIDATES_FOR_CENTERING - 1, 'centroid');
  assert.equal(prepareBoardVectors(w.cands).centered, false);
  assert.equal(prepareBoardVectors(world(5, MIN_CANDIDATES_FOR_CENTERING, 'centroid').cands).centered, true);
});

test('embeddings: wrapper and prepared path agree; empty or mismatched input gives null', () => {
  const w = world(9, 6, 'centroid');
  const prep = prepareBoardVectors(w.cands);
  for (let i = 0; i < 20; i++) { const q = w.onTopic(i); assert.deepEqual(pickBoard(q, prep), pickBoardByEmbedding(q, w.cands)); }
  assert.equal(pickBoardByEmbedding([], w.cands), null);
  assert.equal(pickBoardByEmbedding(w.onTopic(0), []), null);
  assert.equal(pickBoardByEmbedding(new Array(8).fill(0.1), w.cands), null);
});

test('every default board has a hint, and hints only exist for default boards', () => {
  assert.deepEqual(Object.keys(BOARD_HINTS).sort(), Object.keys(DEFAULT_BOARDS).sort());
});
