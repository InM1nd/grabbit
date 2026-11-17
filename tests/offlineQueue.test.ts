import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Each worker is a fresh JS process using the real schema and an on-disk SQLite file.
// Only native transports and remote AI/metadata are replaced.
const harness = String.raw`
const { DatabaseSync } = require('node:sqlite');
const sqlite = new DatabaseSync(process.env.GRABBIT_QUEUE_TEST_DB);
let connected = true, reachable = true, metadataCalls = 0, aiCalls = 0;
let dropDuringMetadata = false, dropDuringAi = false, failAi = false, aiEnabled = false;
const stub = (name, exports) => {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
stub('expo-sqlite', { openDatabaseAsync: async () => ({
  execAsync: async sql => sqlite.exec(sql),
  getAllAsync: async (sql, ...p) => sqlite.prepare(sql).all(...p),
  getFirstAsync: async (sql, ...p) => sqlite.prepare(sql).get(...p) ?? null,
  runAsync: async (sql, ...p) => {
    const r = sqlite.prepare(sql).run(...p);
    return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
  },
}) });
stub('@react-native-community/netinfo', { fetch: async () => ({ isConnected: connected, isInternetReachable: reachable }) });
stub('expo-file-system', { Directory: class {}, File: class {}, Paths: { document: 'file:///tmp' } });
stub('expo-image-manipulator', {});
stub('./src/settings.ts', { loadSettings: async () => {}, getSettings: () => ({ aiEnabled, aiVision: false, igConnected: false }) });
stub('./src/i18n.ts', { t: s => s, getLang: () => 'ru' });
stub('./src/igSession.ts', { igLoaderReady: () => false });
stub('./src/aiAuth.ts', { aiMode: () => 'proxy', getGeminiAuth: async () => ({}) });
stub('./src/core/gemini.ts', { canUseGemini: () => true });
const realAi = require('./src/core/ai.ts');
stub('./src/core/ai.ts', { ...realAi, analyzePost: async () => {
  aiCalls++;
  if (dropDuringAi) { connected = false; throw new Error('network interrupted'); }
  if (failAi) throw new Error('upstream unavailable');
  return { title: 'Restored title', summary: 'Available after reconnect', tags: [], choice: { kind: 'misc', reason: 'forced', confidence: 0 } };
} });
stub('./src/core/metadata.ts', { fetchMetadata: async url => {
  metadataCalls++;
  if (dropDuringMetadata) connected = false;
  return connected !== false && reachable !== false
    ? { url, platform: 'web', title: 'Fetched after reconnect', description: 'Saved article', source: 'test' }
    : { url, platform: 'web', blocked: true, source: 'offline' };
} });
const realEmbed = require('./src/core/embed.ts');
stub('./src/core/embed.ts', { ...realEmbed, embedTexts: async texts => texts.map(() => Array(256).fill(0)) });
const db = require('./src/db.ts');
const { saveShared, processQueue } = require('./src/processor.ts');
const assert = require('node:assert/strict');
(async () => {
`;

function runWorker(database: string, scenario: string) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--eval', harness + scenario + `
    process.exit(0);
  })().catch(error => { console.error(error); process.exit(1); });
  `], {
    cwd: process.cwd(), env: { ...process.env, GRABBIT_QUEUE_TEST_DB: database },
    encoding: 'utf8', timeout: 15_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

function withDatabase(work: (database: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'grabbit-queue-'));
  try { work(join(dir, 'collection.db')); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

test('offline saves persist across process restarts and metadata is fetched after reconnect', () => {
  withDatabase(database => {
    runWorker(database, `
      connected = false;
      const first = await saveShared('https://example.com/offline');
      assert.equal(first.status, 'saved');
      await processQueue(first.id);
      assert.equal((await db.getPost(first.id)).status, 'pending');
    `);
    runWorker(database, `
      connected = false;
      const post = await db.findPostByUrl('https://example.com/offline');
      assert.ok(post);
      for (let i = 0; i < 15; i++) {
        await db.updatePost(post.id, { next_try_at: 0 });
        await processQueue(post.id);
      }
      const deferred = await db.getPost(post.id);
      assert.equal(deferred.status, 'pending');
      assert.equal(deferred.metaFetched, false, 'offline failures must not finalize metadata');
      assert.equal(deferred.attempts, 0, 'offline wakes must not burn remote retry attempts');
      assert.equal(metadataCalls, 0, 'known offline state avoids remote requests');
    `);
    runWorker(database, `
      const post = await db.findPostByUrl('https://example.com/offline');
      await processQueue();
      assert.equal(metadataCalls, 0, 'restart honors the persisted retry time');
      const realNow = Date.now;
      Date.now = () => Math.max(realNow(), post.nextTryAt + 1);
      await processQueue();
      const done = await db.getPost(post.id);
      assert.equal(done.status, 'done');
      assert.equal(done.title, 'Fetched after reconnect');
      assert.equal(metadataCalls, 1);
      assert.equal((await db.listPosts()).length, 1);
      assert.equal((await saveShared('https://example.com/offline')).status, 'duplicate');
    `);
  });
});

test('Wi-Fi without internet and a connection lost while fetching metadata leave work retryable', () => {
  withDatabase(database => runWorker(database, `
    reachable = false;
    const wifi = await saveShared('https://example.com/no-internet');
    await processQueue(wifi.id);
    assert.equal((await db.getPost(wifi.id)).metaFetched, false);
    assert.equal(metadataCalls, 0);
    reachable = true; dropDuringMetadata = true;
    const interrupted = await saveShared('https://example.com/interrupted-meta');
    await db.updatePost(interrupted.id, { attempts: 7 });
    await processQueue(interrupted.id);
    const p = await db.getPost(interrupted.id);
    assert.equal(p.status, 'pending'); assert.equal(p.metaFetched, false); assert.equal(p.attempts, 7);
  `));
});

test('losing the network during the AI request does not exhaust its last retry or block other posts', () => {
  withDatabase(database => runWorker(database, `
    aiEnabled = true; dropDuringAi = true;
    const first = await saveShared('https://example.com/interrupted-ai');
    await db.updatePost(first.id, { meta_fetched: 1, attempts: 11 });
    await processQueue(first.id);
    const pending = await db.getPost(first.id);
    assert.equal(pending.status, 'pending'); assert.equal(pending.attempts, 11);
    connected = true; dropDuringAi = false;
    const second = await saveShared('https://example.com/next');
    await processQueue(second.id);
    assert.equal((await db.getPost(second.id)).status, 'done');
    await db.updatePost(first.id, { next_try_at: 0 });
    await processQueue();
    assert.equal((await db.getPost(first.id)).status, 'done');
    assert.equal(aiCalls, 3);
  `));
});

test('concurrent saves of the same normalized URL return one save and one duplicate', () => {
  withDatabase(database => runWorker(database, `
    const results = await Promise.all([
      saveShared('https://example.com/concurrent', null, null, { note: 'First note' }),
      saveShared('https://example.com/concurrent', null, null, { note: 'Second note' }),
    ]);
    assert.deepEqual(results.map(r => r.status).sort(), ['duplicate', 'saved']);
    assert.equal(results[0].id, results[1].id);
    assert.equal((await db.listPosts()).length, 1);
    assert.equal((await db.getPost(results[0].id)).note, 'First note');
    sqlite.exec("CREATE TRIGGER fail_write BEFORE INSERT ON posts BEGIN SELECT RAISE(ABORT, 'storage failure'); END");
    await assert.rejects(() => saveShared('https://example.com/storage-failure'), /storage failure/);
  `));
});

test('unknown connectivity allows a request and online failures keep the existing retry limit', () => {
  withDatabase(database => runWorker(database, `
    connected = null; reachable = null;
    const unknown = await saveShared('https://example.com/unknown');
    await processQueue(unknown.id);
    assert.equal((await db.getPost(unknown.id)).status, 'done');
    assert.equal(metadataCalls, 1);
    connected = true; reachable = true; aiEnabled = true; failAi = true;
    const failing = await saveShared('https://example.com/upstream-failure');
    await db.updatePost(failing.id, { meta_fetched: 1, attempts: 11 });
    await processQueue(failing.id);
    const stopped = await db.getPost(failing.id);
    assert.equal(stopped.status, 'error'); assert.equal(stopped.attempts, 12);
    assert.equal(stopped.lastError, 'upstream unavailable');
  `));
});
