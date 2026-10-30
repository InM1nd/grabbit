import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BOARDS, boardDisplayName, defaultBoardKey, miscName } from '../src/core/boards';
import { buildPrompt } from '../src/core/ai';

test('default boards are recognised in any language', () => {
  assert.equal(defaultBoardKey('Разное'), 'misc');
  assert.equal(defaultBoardKey('misc'), 'misc');
  assert.equal(defaultBoardKey(' «Різне» '), 'misc');
  assert.equal(defaultBoardKey('AI tools'), 'ai-tools');
  assert.equal(defaultBoardKey('дизайн и ui'), 'design');
  assert.equal(defaultBoardKey('Мои рецепты'), null);
});

test('default boards are shown in the UI language, custom ones as stored', () => {
  assert.equal(boardDisplayName('Разное', 'misc', 'en'), 'Misc');
  assert.equal(boardDisplayName('Разное', 'misc', 'uk'), 'Різне');
  assert.equal(boardDisplayName('Программирование', 'programming', 'en'), 'Programming');
  assert.equal(boardDisplayName('Мои рецепты', null, 'en'), 'Мои рецепты');
  for (const v of Object.values(DEFAULT_BOARDS)) assert.ok(v.ru && v.en && v.uk && v.emoji);
});

test('prompt asks for board names in the UI language', () => {
  const meta = { url: 'https://example.com', platform: 'web' } as any;
  const en = buildPrompt({ meta, boards: ['Misc'], boardLang: 'en' });
  assert.match(en, /in English/); assert.match(en, /"Recipes"/); // 1.10.1: examples of *new* boards are topics without a default board
  assert.match(en, new RegExp(`"${miscName('en')}"`));
  assert.doesNotMatch(en, /"ИИ-инструменты"/);
  const uk = buildPrompt({ meta, boards: [], boardLang: 'uk' });
  assert.match(uk, /«Рецепти»/); assert.match(uk, /"Різне"/);
  assert.match(buildPrompt({ meta, boards: [] }), /"Разное"/);
});
