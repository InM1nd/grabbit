// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const src = readFileSync('src/i18n.ts', 'utf8');
const keys = new Set([...src.matchAll(/^\s*\['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\],?$/gm)].map((m) => m[1]));
const rows = [...src.matchAll(/^\s*\['((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'\],?$/gm)];

const files = ['App.tsx', ...readdirSync('src').filter((f) => /\.tsx?$/.test(f)).map((f) => 'src/' + f), ...readdirSync('src/ui').map((f) => 'src/ui/' + f)];

test('every t() key has EN+UK translations', () => {
  const missing = [];
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) if (!keys.has(m[1])) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('translations keep placeholders and are not Russian for EN', () => {
  for (const [, ru, en, uk] of rows) {
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    assert.equal(ph(en), ph(ru), ru); assert.equal(ph(uk), ph(ru), ru);
    assert.ok(!/[А-Яа-яЁё]/.test(en), 'cyrillic in EN: ' + en);
    assert.ok(!/[ыэъё]/i.test(uk), 'russian letters in UK: ' + uk);
  }
});

test('no untranslated Russian literals left in UI code', () => {
  const bad = [];
  for (const f of files.filter((f) => !/i18n|db\.ts|settings\.ts/.test(f))) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
      const stripped = line.replace(/\bt\('(?:[^'\\]|\\.)*'/g, '');
      if (/[А-Яа-яЁё]/.test(stripped.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, ''))) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
