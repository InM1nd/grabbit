// @ts-nocheck
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(process.cwd() + '/package.json');
const sqlite = new DatabaseSync(':memory:');
const scheduled = new Map();
let permission = true;
let failSchedule = false;
let exportedFile = '';
let picked = null;
const stub = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const connection = {
  execAsync: async (sql) => sqlite.exec(sql),
  getAllAsync: async (sql, ...p) => sqlite.prepare(sql).all(...p),
  getFirstAsync: async (sql, ...p) => sqlite.prepare(sql).get(...p) ?? null,
  runAsync: async (sql, ...p) => {
    const r = sqlite.prepare(sql).run(...p);
    return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
  },
  withExclusiveTransactionAsync: async (work) => {
    sqlite.exec('BEGIN');
    try { await work(connection); sqlite.exec('COMMIT'); }
    catch (e) { sqlite.exec('ROLLBACK'); throw e; }
  },
};
stub('expo-sqlite', { openDatabaseAsync: async () => connection });
stub('expo-document-picker', { getDocumentAsync: async () => picked == null ? { canceled: true } : { assets: [{ uri: 'picked' }] } });
stub('expo-file-system', {
  Paths: { cache: 'cache' },
  File: class {
    uri = 'cache/backup.json'; exists = false;
    create() {} delete() {} write(text) { exportedFile = text; }
    async text() { return picked; }
  },
});
stub('expo-sharing', { shareAsync: async () => {} });
stub('expo-notifications', {
  AndroidImportance: { DEFAULT: 3 }, SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler() {}, setNotificationChannelAsync: async () => {},
  getPermissionsAsync: async () => ({ granted: permission, canAskAgain: false }),
  getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
  scheduleNotificationAsync: async (request) => {
    if (failSchedule) throw new Error('OS queue full');
    scheduled.set(request.identifier, request); return request.identifier;
  },
  cancelScheduledNotificationAsync: async (id) => scheduled.delete(id),
});
stub('react-native', { Platform: { OS: 'android' } });
stub('./src/settings.ts', { getSettings: () => ({ remOn: false }), loadSettings: async () => {} });
stub('./src/i18n.ts', { t: (s) => s, daysPhrase: String });
const db = require('./src/db.ts');
const { buildBackup, exportBackup, importBackup, restoreBackup, validateBackup } = require('./src/backup.ts');
const { postReminderId } = require('./src/core/reminderTime.ts');
const { listPostReminders } = require('./src/reminders.ts');
const backup = (posts, boards = []) => ({ app: 'pinbox', version: 2, posts, boards });

// Real schema and SQL; only native I/O is replaced.
test('backup round trip preserves all marks, notes, board dates and remaps explicit reminders', async () => {
  const boardId = await db.getOrCreateBoard('Reading', '📚');
  await connection.runAsync('UPDATE boards SET created_at = 123 WHERE id = ?', boardId);
  const at = Date.now() + 86_400_000;
  for (const [i, mark] of [null, 'try', 'done', 'skip'].entries()) {
    const id = await db.insertPost({ url: `https://example.com/${i}`, platform: 'web', rawText: 'saved caption', boardId });
    await db.updatePost(id, { mark, note: 'My note', opened_at: 200, reminded_at: 100, summary: 'Summary', status: 'done' });
    scheduled.set(postReminderId(id), { identifier: postReminderId(id), content: { data: { reminderKind: 'post', postId: id, remindAt: at } } });
  }
  scheduled.set('rediscovery', { identifier: 'rediscovery', content: { data: { reminderKind: 'rediscovery', postId: 1, remindAt: at } } });
  scheduled.set('expired', { identifier: 'expired', content: { data: { reminderKind: 'post', postId: 99, remindAt: 1 } } });
  const data = await buildBackup();
  assert.equal(data.version, 2);
  assert.equal(data.posts.length, 4, 'includes skipped posts');
  assert.equal((await listPostReminders()).size, 4);
  assert.ok(data.posts.every((p) => p.remindAt === at));
  assert.equal(await exportBackup(), 4);
  assert.deepEqual(JSON.parse(exportedFile).posts, JSON.parse(JSON.stringify(data.posts)));
  const oldIds = (await db.listPosts()).map((p) => p.id);
  sqlite.exec('DELETE FROM posts; DELETE FROM boards'); scheduled.clear();
  picked = JSON.stringify(data);
  assert.deepEqual(await importBackup(), { added: 4, skipped: 0, remindersRestored: 4, remindersFailed: 0 });
  const restored = await db.listPosts();
  assert.deepEqual(restored.map((p) => p.mark).sort(), [null, 'try', 'done', 'skip'].sort());
  assert.ok(restored.every((p) => !oldIds.includes(p.id) && p.note === 'My note' && p.openedAt === 200 && p.remindedAt === 100));
  assert.equal((await db.listBoards())[0].createdAt, 123);
  for (const p of restored) assert.equal(scheduled.get(postReminderId(p.id)).content.data.remindAt, at);
  await db.updatePost(restored[0].id, { note: 'Newer local note', mark: 'skip' });
  const localReminder = scheduled.get(postReminderId(restored[0].id));
  localReminder.content.data.remindAt = at + 60_000;
  const count = scheduled.size;
  const duplicate = await restoreBackup(data);
  assert.equal(duplicate.skipped, 4); assert.equal(duplicate.remindersRestored, 0); assert.equal(scheduled.size, count);
  assert.equal((await db.getPost(restored[0].id)).note, 'Newer local note');
  assert.equal((await db.getPost(restored[0].id)).mark, 'skip');
  assert.equal(scheduled.get(postReminderId(restored[0].id)).content.data.remindAt, at + 60_000);
});

test('legacy exports default marks and expired reminders are not scheduled', async () => {
  for (const [i, app] of ['pinbox', 'polka'].entries()) {
    await restoreBackup({ app, version: 1, posts: [{ url: `https://legacy.test/${i}`, remindAt: 1 }] });
    const post = await db.findPostByUrl(`https://legacy.test/${i}`);
    assert.equal(post.mark, null); assert.equal(scheduled.has(postReminderId(post.id)), false);
  }
  assert.equal(validateBackup({ app: 'polka', posts: [] }).version, 1);
  picked = null; assert.equal(await importBackup(), null);
  picked = '{'; await assert.rejects(importBackup, /JSON/);
});

test('permission denial and OS scheduling failure retain imported posts and report reminders', async () => {
  for (const [i, denied] of [true, false].entries()) {
    permission = !denied; failSchedule = !denied;
    const r = await restoreBackup(backup([{ url: `https://permission.test/${i}`, remindAt: Date.now() + 60_000, mark: 'try' }]));
    assert.deepEqual(r, { added: 1, skipped: 0, remindersRestored: 0, remindersFailed: 1 });
    assert.equal((await db.findPostByUrl(`https://permission.test/${i}`)).mark, 'try');
  }
  permission = true; failSchedule = false;
});

test('bad files are rejected before writes; unknown future versions are rejected', async () => {
  const before = (await db.listPosts()).length;
  for (const bad of [
    { ...backup([]), version: 99 }, { ...backup([]), app: 'other' },
    backup([{ url: 'https://invalid.test', board: {} }]),
    backup([{ url: 'https://invalid.test', tags: [1] }]),
    backup([{ url: 'https://invalid.test', mark: 'arbitrary' }]),
    backup([{ url: 'https://invalid.test', remindAt: 'tomorrow' }]),
    backup([{ url: 'https://invalid.test', remindAt: Infinity }]),
    backup([], [{ name: 3 }]),
  ]) await assert.rejects(() => restoreBackup(bad));
  assert.equal((await db.listPosts()).length, before);
  const source = { app: 'pinbox', version: 1, posts: [{ url: 'file:///etc/passwd' }] };
  assert.equal(validateBackup(source).posts.length, 0);
  assert.equal(source.posts.length, 1, 'validation must not mutate input');
});

test('failed SQL rolls back the posts batch and schedules no notifications', async () => {
  const before = scheduled.size;
  sqlite.exec(`CREATE TRIGGER fail_backup BEFORE INSERT ON posts WHEN NEW.url = 'https://rollback.test/fail' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
  await assert.rejects(() => restoreBackup(backup([
    { url: 'https://rollback.test/first', remindAt: Date.now() + 60_000 },
    { url: 'https://rollback.test/fail' },
  ])), /injected failure/);
  assert.equal(await db.findPostByUrl('https://rollback.test/first'), null);
  assert.equal(scheduled.size, before);
  sqlite.exec('DROP TRIGGER fail_backup');
});
