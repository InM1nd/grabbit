// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Exercise the real DB functions against SQLite, replacing only Expo's native transport.
const require = createRequire(process.cwd() + '/package.json');
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* Node 20 has no built-in SQLite. */ }
const sqlite = DatabaseSync ? new DatabaseSync(':memory:') : null;
const nativePath = require.resolve('expo-sqlite');
if (sqlite) require.cache[nativePath] = { id: nativePath, filename: nativePath, loaded: true, exports: {
  openDatabaseAsync: async () => ({
    execAsync: async (sql) => { sqlite.exec(sql); },
    getAllAsync: async (sql, ...params) => sqlite.prepare(sql).all(...params),
    getFirstAsync: async (sql, ...params) => sqlite.prepare(sql).get(...params) ?? null,
    runAsync: async (sql, ...params) => { const r = sqlite.prepare(sql).run(...params); return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) }; },
  }),
} };
const db = sqlite ? require('./src/db.ts') : null;
const { onDataChanged } = require('./src/events.ts');

test('new post stores note and selected board before notifying the processing queue', { skip: !sqlite }, async () => {
  await db.getDb();
  const board = sqlite.prepare('INSERT INTO boards (name, created_at) VALUES (?, ?)').run('Recipes', Date.now());
  let snapshot;
  const off = onDataChanged(() => { snapshot = sqlite.prepare('SELECT note, board_id FROM posts WHERE url = ?').get('https://example.com/new'); });
  const id = await db.insertPost({ url: 'https://example.com/new', rawText: null, platform: 'web', note: 'Try on Sunday', boardId: Number(board.lastInsertRowid) });
  off();
  assert.deepEqual({ ...snapshot }, { note: 'Try on Sunday', board_id: Number(board.lastInsertRowid) });
  const post = await db.getPost(id);
  assert.equal(post.note, 'Try on Sunday');
  assert.equal(post.boardId, Number(board.lastInsertRowid));
  assert.equal(post.status, 'pending');
});

test('incoming share callers can still omit note and board', { skip: !sqlite }, async () => {
  const id = await db.insertPost({ url: 'https://example.com/shared', rawText: 'Shared caption', platform: 'web' });
  const post = await db.getPost(id);
  assert.equal(post.note, null);
  assert.equal(post.boardId, null);
  assert.equal(post.rawText, 'Shared caption');
});

test('default boards: one board across languages, localized names, rename makes it custom', { skip: !sqlite }, async () => {
  const { setUiLang } = require('./src/core/uiLang.ts');
  await db.getDb();
  setUiLang('ru');
  const a = await db.getOrCreateBoard('Разное');
  const b = await db.getOrCreateBoard('Misc');
  assert.equal(a, b);
  assert.equal(sqlite.prepare('SELECT key FROM boards WHERE id = ?').get(a).key, 'misc');
  setUiLang('en');
  assert.equal((await db.listBoards()).find((x) => x.id === a).name, 'Misc');
  assert.ok((await db.boardNames()).includes('Misc'));
  setUiLang('uk');
  assert.equal((await db.listBoards()).find((x) => x.id === a).name, 'Різне');
  const custom = await db.getOrCreateBoard('Мои рецепты');
  assert.equal((await db.listBoards()).find((x) => x.id === custom).name, 'Мои рецепты');
  await db.renameBoard(a, 'Всяке');
  const row = sqlite.prepare('SELECT name, key FROM boards WHERE id = ?').get(a);
  assert.deepEqual({ ...row }, { name: 'Всяке', key: null });
  setUiLang('ru');
});

test('a targeted lookup finds a fresh post regardless of backlog, while honoring retry time', { skip: !sqlite }, async () => {
  for (let i = 0; i < 25; i++) {
    await db.insertPost({ url: 'https://example.com/backlog/' + i, rawText: null, platform: 'web' });
  }
  const id = await db.insertPost({ url: 'https://example.com/fresh', rawText: null, platform: 'web' });
  const now = Date.now();
  assert.equal((await db.nextPendingPost(now, id))?.id, id);
  await db.updatePost(id, { next_try_at: now + 30_000 });
  assert.equal(await db.nextPendingPost(now, id), null);
  assert.notEqual((await db.nextPendingPost(now))?.id, id);
});

test('analysis saves its summary without overwriting a newer board selection', { skip: !sqlite }, async () => {
  const id = await db.insertPost({ url: 'https://example.com/board-race', rawText: null, platform: 'web' });
  const manual = await db.getOrCreateBoard('Manual board');
  const suggested = await db.getOrCreateBoard('Suggested board');
  await db.updatePost(id, { board_id: manual });
  await db.updatePost(id, { summary: 'Available now', status: 'done' }, { from: null, to: suggested, needsResort: false });
  const post = await db.getPost(id);
  assert.equal(post.boardId, manual);
  assert.equal(post.summary, 'Available now');

  await db.updatePost(id, { summary: 'Updated again' }, { from: manual, to: suggested, needsResort: true });
  const moved = await db.getPost(id);
  assert.equal(moved.boardId, suggested);
  assert.equal(moved.needsResort, true);
});

test('a stale Misc move cannot replace a manual board and summary sources survive reopening', { skip: !sqlite }, async () => {
  const misc = await db.miscBoardId();
  const manual = await db.getOrCreateBoard('Manual assignment');
  const id = await db.insertPost({ url: 'https://example.com/guarded-move', rawText: null, platform: 'web', boardId: misc });
  await db.updatePost(id, { board_id: manual, summary_sources: ['caption', 'cover'], detailed_summary: 'More detail', detail_source: 'article' });
  assert.equal(await db.updatePost(id, { board_id: misc, summary: 'Stale' }, undefined, { boardId: misc }), false);
  assert.equal(await db.updatePost(id, { board_id: misc }, undefined, { boardId: manual, ready: true }), false);
  const post = await db.getPost(id);
  assert.equal(post.boardId, manual);
  assert.deepEqual(post.summarySources, ['caption', 'cover']);
  assert.equal(post.detailSource, 'article');
  assert.equal(post.detailedSummary, 'More detail');
});
