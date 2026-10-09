import * as SQLite from 'expo-sqlite';
import type { Platform } from './core/types';
import { emitDataChanged } from './events';

export type PostStatus = 'pending' | 'done' | 'error';

export interface Post {
  id: number;
  url: string;
  rawText: string | null;
  platform: Platform;
  title: string | null;
  description: string | null;
  author: string | null;
  image: string | null;       // remote thumbnail url
  localImage: string | null;  // cached copy (IG/TikTok CDN links expire)
  metaFetched: boolean;
  metaBlocked: boolean;
  unavailable: boolean;
  note: string | null;
  aiTitle: string | null;
  summary: string | null;
  tags: string[];
  boardId: number | null;
  status: PostStatus;
  attempts: number;
  nextTryAt: number;
  lastError: string | null;
  createdAt: number;
  openedAt: number | null;
  remindedAt: number | null;
}

export interface Board {
  id: number;
  name: string;
  emoji: string | null;
  createdAt: number;
  count: number;
  covers: string[];
}

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('polka.db');
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS boards (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          emoji TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS posts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL UNIQUE,
          raw_text TEXT,
          platform TEXT NOT NULL DEFAULT 'web',
          title TEXT, description TEXT, author TEXT, image TEXT, local_image TEXT,
          meta_fetched INTEGER NOT NULL DEFAULT 0,
          meta_blocked INTEGER NOT NULL DEFAULT 0,
          ai_title TEXT, summary TEXT, tags TEXT NOT NULL DEFAULT '[]',
          board_id INTEGER REFERENCES boards(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          next_try_at INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_at INTEGER NOT NULL,
          opened_at INTEGER,
          reminded_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_posts_board ON posts(board_id);
        CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      `);
      // v2 columns (user note, "post is not public" flag)
      const cols = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(posts)')).map((c) => c.name);
      if (!cols.includes('note')) await db.execAsync('ALTER TABLE posts ADD COLUMN note TEXT');
      if (!cols.includes('unavailable')) await db.execAsync('ALTER TABLE posts ADD COLUMN unavailable INTEGER NOT NULL DEFAULT 0');
      await db.execAsync('PRAGMA foreign_keys = ON;');
      return db;
    })();
  }
  return dbPromise;
}

function rowToPost(r: any): Post {
  let tags: string[] = [];
  try { tags = JSON.parse(r.tags || '[]'); } catch {}
  return {
    id: r.id, url: r.url, rawText: r.raw_text, platform: r.platform,
    title: r.title, description: r.description, author: r.author, image: r.image, localImage: r.local_image,
    metaFetched: !!r.meta_fetched, metaBlocked: !!r.meta_blocked, unavailable: !!r.unavailable, note: r.note ?? null,
    aiTitle: r.ai_title, summary: r.summary, tags, boardId: r.board_id,
    status: r.status, attempts: r.attempts, nextTryAt: r.next_try_at, lastError: r.last_error,
    createdAt: r.created_at, openedAt: r.opened_at, remindedAt: r.reminded_at,
  };
}

export async function findPostByUrl(url: string): Promise<Post | null> {
  const db = await getDb();
  const r = await db.getFirstAsync('SELECT * FROM posts WHERE url = ?', url);
  return r ? rowToPost(r) : null;
}

export async function insertPost(p: { url: string; rawText: string | null; platform: Platform; title?: string | null }): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    'INSERT INTO posts (url, raw_text, platform, title, created_at) VALUES (?, ?, ?, ?, ?)',
    p.url, p.rawText, p.platform, p.title ?? null, Date.now(),
  );
  emitDataChanged();
  return Number(res.lastInsertRowId);
}

export async function getPost(id: number): Promise<Post | null> {
  const db = await getDb();
  const r = await db.getFirstAsync('SELECT * FROM posts WHERE id = ?', id);
  return r ? rowToPost(r) : null;
}

export async function listPosts(opts: { boardId?: number | null; query?: string } = {}): Promise<Post[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.boardId != null) { where.push('p.board_id = ?'); params.push(opts.boardId); }
  const q = (opts.query || '').trim().toLowerCase();
  const rows = await db.getAllAsync(
    `SELECT p.*, b.name AS board_name FROM posts p LEFT JOIN boards b ON b.id = p.board_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.created_at DESC`,
    ...params,
  );
  let posts = rows.map((r: any) => ({ post: rowToPost(r), board: (r.board_name as string) || '' }));
  if (q) {
    // SQLite LOWER() only folds ASCII, so filter in JS to handle Cyrillic properly.
    const terms = q.split(/\s+/).filter(Boolean);
    posts = posts.filter(({ post, board }) => {
      const hay = [post.aiTitle, post.title, post.summary, post.note, post.description, post.author, board, post.url, ...post.tags.map((t) => '#' + t)]
        .filter(Boolean).join(' \n ').toLowerCase();
      return terms.every((t) => hay.includes(t.replace(/^#/, '')));
    });
  }
  return posts.map((x) => x.post);
}

export async function updatePost(id: number, fields: Partial<Record<string, any>>) {
  const db = await getDb();
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sql = `UPDATE posts SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  await db.runAsync(sql, ...keys.map((k) => (k === 'tags' ? JSON.stringify(fields[k]) : fields[k])), id);
  emitDataChanged();
}

export async function deletePost(id: number) {
  const db = await getDb();
  await db.runAsync('DELETE FROM posts WHERE id = ?', id);
  emitDataChanged();
}

export async function markOpened(id: number) {
  const db = await getDb();
  await db.runAsync('UPDATE posts SET opened_at = ? WHERE id = ? AND opened_at IS NULL', Date.now(), id);
  emitDataChanged();
}

export async function listBoards(): Promise<Board[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT b.*, COUNT(p.id) AS cnt, MAX(p.created_at) AS last FROM boards b
     LEFT JOIN posts p ON p.board_id = b.id GROUP BY b.id ORDER BY last DESC NULLS LAST, b.created_at DESC`,
  );
  const covers = await db.getAllAsync<any>(
    `SELECT board_id, COALESCE(local_image, image) AS img FROM posts
     WHERE board_id IS NOT NULL AND COALESCE(local_image, image) IS NOT NULL ORDER BY created_at DESC`,
  );
  const byBoard = new Map<number, string[]>();
  for (const c of covers) {
    const arr = byBoard.get(c.board_id) || [];
    if (arr.length < 3) arr.push(c.img);
    byBoard.set(c.board_id, arr);
  }
  return rows.map((r) => ({ id: r.id, name: r.name, emoji: r.emoji, createdAt: r.created_at, count: r.cnt, covers: byBoard.get(r.id) || [] }));
}

export async function boardNames(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ name: string }>('SELECT name FROM boards ORDER BY name');
  return rows.map((r) => r.name);
}

export async function getOrCreateBoard(name: string, emoji?: string | null): Promise<number> {
  const db = await getDb();
  const clean = name.trim().slice(0, 40) || 'Разное';
  const ex = await db.getFirstAsync<{ id: number; emoji: string | null }>('SELECT id, emoji FROM boards WHERE name = ?', clean);
  if (ex) {
    if (!ex.emoji && emoji) await db.runAsync('UPDATE boards SET emoji = ? WHERE id = ?', emoji, ex.id);
    return ex.id;
  }
  const r = await db.runAsync('INSERT INTO boards (name, emoji, created_at) VALUES (?, ?, ?)', clean, emoji ?? null, Date.now());
  emitDataChanged();
  return Number(r.lastInsertRowId);
}

export async function renameBoard(id: number, name: string, emoji?: string | null) {
  const db = await getDb();
  const clean = name.trim().slice(0, 40);
  if (!clean) return;
  const other = await db.getFirstAsync<{ id: number }>('SELECT id FROM boards WHERE name = ? AND id != ?', clean, id);
  if (other) {
    // merging into an existing board
    await db.runAsync('UPDATE posts SET board_id = ? WHERE board_id = ?', other.id, id);
    await db.runAsync('DELETE FROM boards WHERE id = ?', id);
  } else {
    await db.runAsync('UPDATE boards SET name = ?, emoji = COALESCE(?, emoji) WHERE id = ?', clean, emoji ?? null, id);
  }
  emitDataChanged();
}

export async function deleteBoard(id: number) {
  const db = await getDb();
  await db.runAsync('UPDATE posts SET board_id = NULL WHERE board_id = ?', id);
  await db.runAsync('DELETE FROM boards WHERE id = ?', id);
  emitDataChanged();
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return r?.value ?? null;
}
export async function setSetting(key: string, value: string | null) {
  const db = await getDb();
  if (value == null) await db.runAsync('DELETE FROM settings WHERE key = ?', key);
  else await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
}

export async function pendingPosts(now = Date.now()): Promise<Post[]> {
  const db = await getDb();
  const rows = await db.getAllAsync("SELECT * FROM posts WHERE status = 'pending' AND next_try_at <= ? ORDER BY created_at ASC LIMIT 20", now);
  return rows.map(rowToPost);
}
export async function countPending(): Promise<number> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM posts WHERE status != 'done'");
  return r?.n ?? 0;
}
export async function nextRetryAt(): Promise<number | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ t: number | null }>("SELECT MIN(next_try_at) AS t FROM posts WHERE status = 'pending'");
  return r?.t ?? null;
}

export async function unopenedPosts(): Promise<Post[]> {
  const db = await getDb();
  const rows = await db.getAllAsync('SELECT * FROM posts WHERE opened_at IS NULL ORDER BY created_at ASC');
  return rows.map(rowToPost);
}
