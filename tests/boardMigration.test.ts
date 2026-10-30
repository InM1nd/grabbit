// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(process.cwd() + '/package.json');
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch {}
const sqlite = DatabaseSync ? new DatabaseSync(':memory:') : null;
const nativePath = require.resolve('expo-sqlite');
if (sqlite) {
  // A pre-1.10 database: version 5 schema with legacy board names.
  sqlite.exec(`CREATE TABLE boards (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, emoji TEXT, created_at INTEGER NOT NULL, key TEXT);`);
}
if (sqlite) require.cache[nativePath] = { id: nativePath, filename: nativePath, loaded: true, exports: {
  openDatabaseAsync: async () => ({
    execAsync: async (sql) => { sqlite.exec(sql); },
    getAllAsync: async (sql, ...p) => sqlite.prepare(sql).all(...p),
    getFirstAsync: async (sql, ...p) => sqlite.prepare(sql).get(...p) ?? null,
    runAsync: async (sql, ...p) => { const r = sqlite.prepare(sql).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
  }),
} };
const db = sqlite ? require('./src/db.ts') : null;

test('migration: legacy names get keys / merge, AI boards get translations once, renames win', { skip: !sqlite }, async () => {
  const { setUiLang } = require('./src/core/uiLang.ts');
  sqlite.exec(`DROP TABLE boards`);
  await db.getDb();
  const ins = (n, k = null) => Number(sqlite.prepare('INSERT INTO boards (name, created_at, key, tr_done) VALUES (?, 0, ?, 0)').run(n, k).lastInsertRowid);
  const misc = ins('Разное', 'misc');
  const other = ins('Другое');
  const design = ins('Дизайн');
  const psy = ins('Психология');
  const post = await db.insertPost({ url: 'https://e.com/1', rawText: null, platform: 'web', boardId: other });
  await db.rekeyLegacyBoards(await db.getDb());
  assert.equal((await db.getPost(post)).boardId, misc, 'posts of a duplicate misc board are merged');
  assert.equal(sqlite.prepare('SELECT key FROM boards WHERE id = ?').get(design).key, 'design');
  setUiLang('en');
  assert.equal((await db.listBoards()).find((b) => b.id === design).name, 'Design & UI');

  const todo = await db.boardsNeedingTranslation();
  assert.deepEqual(todo.map((b) => b.id), [psy]);
  await db.setBoardTranslations(psy, { ru: 'Психология', en: 'Psychology', uk: 'Психологія' });
  assert.equal((await db.listBoards()).find((b) => b.id === psy).name, 'Psychology');
  assert.equal((await db.boardsNeedingTranslation()).length, 0);

  await db.renameBoard(psy, 'Мозги');
  await db.setBoardTranslations(psy, { ru: 'x', en: 'y', uk: 'z' }); // late translation must not override a rename
  assert.equal((await db.listBoards()).find((b) => b.id === psy).name, 'Мозги');
  await db.renameBoard(design, 'Дизайн');
  await db.rekeyLegacyBoards(await db.getDb());
  assert.equal(sqlite.prepare('SELECT key FROM boards WHERE id = ?').get(design).key, null, 'a renamed board stays custom');
});

test('boardForChoice + needs_resort + misc list', { skip: !sqlite }, async () => {
  const misc = await db.miscBoardId();
  const id = await db.boardForChoice({ kind: 'new', names: { ru: 'Путешествия', en: 'Travel', uk: 'Подорожі' }, confidence: 0.9 }, '✈️');
  assert.equal(await db.boardForChoice({ kind: 'new', names: { ru: 'Путешествия', en: 'Travel', uk: 'Подорожі' }, confidence: 0.9 }), id, 'same names → same board');
  assert.equal(await db.boardForChoice({ kind: 'existing', id: 9999, confidence: 1 }), misc);
  const p = await db.insertPost({ url: 'https://e.com/2', rawText: null, platform: 'instagram', boardId: misc });
  await db.updatePost(p, { needs_resort: 1, status: 'done' });
  const list = await db.miscPosts();
  assert.ok(list.some((x) => x.id === p && x.needsResort));
  const ab = await db.aiBoards();
  assert.ok(ab.some((b) => b.id === id && b.nameEn === 'Travel'));
});
