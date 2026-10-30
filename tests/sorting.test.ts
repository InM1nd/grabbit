import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultBoardKey, findBoardByName, boardDisplayName } from '../src/core/boards';
import { resolveBoard, clampConfidence, cleanBoardName, pickBoardByEmbedding, centroid, parseTranslations, NEW_BOARD_MIN_CONFIDENCE } from '../src/core/sorting';
import { boardLines } from '../src/core/ai';

const boards = [
  { id: 1, name: 'AI tools', key: 'ai-tools' },
  { id: 2, name: 'Рецепты', tags: ['паста'] },
  { id: 3, name: 'Misc', key: 'misc' },
  { id: 4, name: 'Фитнес', nameEn: 'Fitness', nameUk: 'Фітнес' },
];

test('synonyms map legacy spellings to default boards', () => {
  assert.equal(defaultBoardKey('Другое'), 'misc');
  assert.equal(defaultBoardKey('ИИ-инструменты'), 'ai-tools');
  assert.equal(defaultBoardKey('Дизайн'), 'design');
  assert.equal(defaultBoardKey('Програмування'), 'programming');
  assert.equal(defaultBoardKey('Рецепты'), null);
  assert.equal(findBoardByName('fitness', boards)?.id, 4);
  assert.equal(findBoardByName('ИИ инструменты', boards)?.id, 1);
});

test('display name: default by key, AI board by stored translation, else as stored', () => {
  assert.equal(boardDisplayName('Разное', 'misc', 'en'), 'Misc');
  assert.equal(boardDisplayName('Фитнес', null, 'en', { ru: 'Фитнес', en: 'Fitness', uk: 'Фітнес' }), 'Fitness');
  assert.equal(boardDisplayName('Мои штуки', null, 'uk'), 'Мои штуки');
});

test('resolveBoard: id first, misc id, unknown id falls back to name', () => {
  assert.deepEqual(resolveBoard({ boardId: '2', confidence: 0.9 }, boards, 'ru'), { kind: 'existing', id: 2, confidence: 0.9 });
  assert.equal(resolveBoard({ boardId: 'id=3', confidence: 0.9 }, boards, 'ru').kind, 'misc');
  assert.deepEqual(resolveBoard({ boardId: '99', board: 'Fitness', confidence: 80 }, boards, 'en'), { kind: 'existing', id: 4, confidence: 0.8 });
});

test('resolveBoard: new board only when confident, reuses existing/default names', () => {
  const nb = { ru: 'Путешествия', en: 'Travel', uk: 'Подорожі' };
  const ok = resolveBoard({ boardId: 'new', newBoard: nb, confidence: NEW_BOARD_MIN_CONFIDENCE }, boards, 'ru');
  assert.equal(ok.kind, 'new');
  assert.deepEqual(ok.kind === 'new' && ok.names, nb);
  const unsure = resolveBoard({ boardId: 'new', newBoard: nb, confidence: 0.5 }, boards, 'ru');
  assert.deepEqual(unsure, { kind: 'misc', confidence: 0.5, reason: 'unsure' });
  assert.deepEqual(resolveBoard({ boardId: 'new', newBoard: { ru: 'Фитнес', en: 'Fitness', uk: 'Фітнес' }, confidence: 0.9 }, boards, 'ru'), { kind: 'existing', id: 4, confidence: 0.9 });
  const def = resolveBoard({ boardId: 'new', newBoard: { ru: 'Дизайн', en: 'Design', uk: 'Дизайн' }, confidence: 0.9 }, boards, 'ru');
  assert.equal(def.kind === 'new' && def.names.en, 'Design & UI');
  assert.equal(resolveBoard({ board: 'Совсем новое', confidence: 0.4 }, boards, 'ru').kind, 'misc');
});

test('cleanBoardName drops junk and wrong-language names; partial new boards get translated later', () => {
  assert.equal(cleanBoardName('Творчість та арт唱EN:', 'uk'), 'Творчість та арт');
  assert.equal(cleanBoardName('Арт и творчество', 'en'), '');
  assert.equal(cleanBoardName('Art & Craft', 'en'), 'Art & Craft');
  const r = resolveBoard({ boardId: 'new', newBoard: { ru: 'Арт', en: 'Арт', uk: 'Арт' }, confidence: 0.9 }, boards, 'en');
  assert.ok(r.kind === 'new' && r.partial && r.names.en === 'Арт');
});

test('clampConfidence', () => {
  assert.equal(clampConfidence(undefined), 0.6);
  assert.equal(clampConfidence(85), 0.85);
  assert.equal(clampConfidence(-1), 0);
});

test('embedding pick: clear leader wins, near-tie or weak match does not', () => {
  const v = (a: number, b: number, c: number) => [a, b, c];
  const cands = [
    { id: 1, vec: centroid([v(1, 0.2, 0.2), v(0.9, 0.3, 0.2)])!, kind: 'centroid' as const },
    { id: 2, vec: centroid([v(0.2, 1, 0.2), v(0.3, 0.9, 0.2)])!, kind: 'centroid' as const },
  ];
  assert.equal(pickBoardByEmbedding(v(1, 0.25, 0.2), cands)?.id, 1);
  assert.equal(pickBoardByEmbedding(v(0.6, 0.6, 0.2), cands), null);
  assert.equal(pickBoardByEmbedding(v(0, 0, 1), cands), null);
  assert.equal(pickBoardByEmbedding(null, cands), null);
});

test('translations: parsed, cleaned, unknown ids ignored', () => {
  const m = parseTranslations({ boardNames: [
    { id: 7, ru: 'Психология', en: 'Psychology', uk: 'Психологія' },
    { id: 8, ru: 'Smart home', en: 'Smart home', uk: 'Smart home' },
    { id: 9, ru: 'x', en: 'Путешествия', uk: 'y' },
    { id: 99, ru: 'a', en: 'b', uk: 'c' },
  ] }, [7, 8, 9]);
  assert.deepEqual(m.get(7), { ru: 'Психология', en: 'Psychology', uk: 'Психологія' });
  assert.equal(m.get(8)?.ru, 'Smart home');
  assert.equal(m.has(9), false);
  assert.equal(m.has(99), false);
});

test('board list in the prompt fits the proxy prompt budget', () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: 'Очень длинное название доски ' + i, tags: ['тег-один', 'тег-два', 'тег-три', 'тег-четыре', 'тег-пять'] }));
  const lines = boardLines(many);
  assert.ok(lines.length <= 80);
  assert.ok(lines.join('\n').length <= 4500);
});

test('server response schema has the same fields as the app schema', async () => {
  const { SCHEMA } = await import('../src/core/ai');
  const { RESPONSE_SCHEMA } = await import('../server/lib/validate');
  const strip = (o: any): any => (Array.isArray(o) ? o.map(strip) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'description').map(([k, v]) => [k, strip(v)])) : o);
  assert.deepEqual(strip(RESPONSE_SCHEMA), strip(SCHEMA));
});
