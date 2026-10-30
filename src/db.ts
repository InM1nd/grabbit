import { DEFAULT_BOARDS, boardDisplayName, defaultBoardKey, findBoardByName, miscName, type BoardLang } from './core/boards';
import type { AiBoard, BoardChoice } from './core/sorting';
import { getUiLang as getLang } from './core/uiLang';
import * as SQLite from 'expo-sqlite';
import type { Platform } from './core/types';
import { emitDataChanged } from './events';
import { EMBED_MODEL, unpackVec } from './core/embed';

export type PostStatus = 'pending' | 'done' | 'error';
/** User's own mark: try it / done / not important. null = none. */
export type { PostMark } from './core/marks';
import type { PostMark } from './core/marks';
export const MARKS: PostMark[] = ['try', 'done', 'skip'];

export interface Post {
  id: number;
  url: string;
  rawText: string | null;
  /** A screenshot was attached by the user (localImage is that screenshot). */
  shot?: boolean;
  /** Put into Misc only because the post was closed; re-sorted once it gets content. */
  needsResort?: boolean;
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
  mark: PostMark | null;
  embedding: number[] | null;
}

export interface Board {
  id: number;
  name: string;
  emoji: string | null;
  /** Stable id of a built-in board (name is then localized); null for the user's own boards. */
  key?: string | null;
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
      // v3 (1.3.0): user mark + semantic embedding. Additive, nullable → safe for existing installs.
      if (!cols.includes('mark')) await db.execAsync('ALTER TABLE posts ADD COLUMN mark TEXT');
      if (!cols.includes('embedding')) await db.execAsync('ALTER TABLE posts ADD COLUMN embedding TEXT');
      if (!cols.includes('embed_model')) await db.execAsync('ALTER TABLE posts ADD COLUMN embed_model TEXT');
      // v4 (1.7.0): user-attached screenshot → always show it to the AI
      // v5 (1.8.0): default boards get a stable key and are shown in the UI language
      const bcols = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(boards)')).map((c) => c.name);
      if (!bcols.includes('key')) {
        await db.execAsync('ALTER TABLE boards ADD COLUMN key TEXT');
        for (const [k, v] of Object.entries(DEFAULT_BOARDS)) await db.runAsync('UPDATE boards SET key = ? WHERE key IS NULL AND name = ? COLLATE NOCASE', k, v.ru);
      }
      if (!cols.includes('shot')) await db.execAsync('ALTER TABLE posts ADD COLUMN shot INTEGER NOT NULL DEFAULT 0');
      // v6 (1.10.0): translations for the user's/AI boards, re-sort flag for closed posts parked in Misc
      if (!cols.includes('needs_resort')) await db.execAsync('ALTER TABLE posts ADD COLUMN needs_resort INTEGER NOT NULL DEFAULT 0');
      for (const c of ['name_ru', 'name_en', 'name_uk']) if (!bcols.includes(c)) await db.execAsync(`ALTER TABLE boards ADD COLUMN ${c} TEXT`);
      // tr_done: 0 = translate once by AI, 1 = has translations or is the user's own name (never touch)
      if (!bcols.includes('tr_done')) await db.execAsync('ALTER TABLE boards ADD COLUMN tr_done INTEGER NOT NULL DEFAULT 0');
      await rekeyLegacyBoards(db);
      await db.execAsync('PRAGMA foreign_keys = ON;');
      return db;
    })();
  }
  return dbPromise;
}

// Parsed-embedding cache: avoids JSON.parse of every vector on every feed reload.
const vecCache = new Map<number, { raw: string; vec: number[] | null }>();
function cachedVec(id: number, raw: string | null): number[] | null {
  if (!raw) { vecCache.delete(id); return null; }
  const hit = vecCache.get(id);
  if (hit && hit.raw === raw) return hit.vec;
  const vec = unpackVec(raw);
  vecCache.set(id, { raw, vec });
  return vec;
}

/**
 * Legacy default boards with a different spelling ("Другое", "ИИ инструменты", "Дизайн"…) get their key.
 * If the keyed board already exists, the legacy one is merged into it. Idempotent, runs on every start; boards the user created or renamed (tr_done = 1) are left alone.
 */
export async function rekeyLegacyBoards(db: SQLite.SQLiteDatabase) {
  const rows = await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM boards WHERE key IS NULL AND tr_done = 0');
  for (const r of rows) {
    const k = defaultBoardKey(r.name);
    if (!k) continue;
    const owner = await db.getFirstAsync<{ id: number }>('SELECT id FROM boards WHERE key = ?', k);
    if (owner) {
      await db.runAsync('UPDATE posts SET board_id = ? WHERE board_id = ?', owner.id, r.id);
      await db.runAsync('DELETE FROM boards WHERE id = ?', r.id);
    } else {
      await db.runAsync('UPDATE boards SET key = ?, tr_done = 1 WHERE id = ?', k, r.id);
    }
  }
}

const trOf = (r: any) => ({ ru: r.name_ru, en: r.name_en, uk: r.name_uk });
const showName = (r: any, lang: BoardLang = getLang()) => boardDisplayName(r.name, r.key, lang, trOf(r));

function rowToPost(r: any): Post {
  let tags: string[] = [];
  try { tags = JSON.parse(r.tags || '[]'); } catch {}
  return {
    id: r.id, url: r.url, rawText: r.raw_text, platform: r.platform,
    title: r.title, description: r.description, author: r.author, image: r.image, localImage: r.local_image,
    metaFetched: !!r.meta_fetched, shot: !!r.shot, needsResort: !!r.needs_resort, metaBlocked: !!r.meta_blocked, unavailable: !!r.unavailable, note: r.note ?? null,
    aiTitle: r.ai_title, summary: r.summary, tags, boardId: r.board_id,
    status: r.status, attempts: r.attempts, nextTryAt: r.next_try_at, lastError: r.last_error,
    createdAt: r.created_at, openedAt: r.opened_at, remindedAt: r.reminded_at,
    mark: r.mark === 'try' || r.mark === 'done' || r.mark === 'skip' ? r.mark : null,
    embedding: r.embed_model === EMBED_MODEL ? cachedVec(r.id, r.embedding) : null,
  };
}

export async function findPostByUrl(url: string): Promise<Post | null> {
  const db = await getDb();
  const r = await db.getFirstAsync('SELECT * FROM posts WHERE url = ?', url);
  return r ? rowToPost(r) : null;
}

export async function insertPost(p: { url: string; rawText: string | null; platform: Platform; title?: string | null; note?: string | null; boardId?: number | null }): Promise<number> {
  const db = await getDb();
  const res = await db.runAsync(
    'INSERT INTO posts (url, raw_text, platform, title, note, board_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    p.url, p.rawText, p.platform, p.title ?? null, p.note ?? null, p.boardId ?? null, Date.now(),
  );
  emitDataChanged();
  return Number(res.lastInsertRowId);
}

export async function getPost(id: number): Promise<Post | null> {
  const db = await getDb();
  const r = await db.getFirstAsync('SELECT * FROM posts WHERE id = ?', id);
  return r ? rowToPost(r) : null;
}

/**
 * `marks`: show only these marks ('none' = unmarked). Default: everything except 'skip'
 * («Неважно» is hidden unless explicitly asked for).
 */
export { markAllowed, type MarkFilter } from './core/marks';
import type { MarkFilter } from './core/marks';
import { markAllowed } from './core/marks';

export async function listPosts(opts: { boardId?: number | null; query?: string; mark?: MarkFilter } = {}): Promise<Post[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.boardId != null) { where.push('p.board_id = ?'); params.push(opts.boardId); }
  const q = (opts.query || '').trim().toLowerCase();
  const rows = await db.getAllAsync(
    `SELECT p.*, b.name AS board_name, b.key AS board_key, b.name_ru AS b_ru, b.name_en AS b_en, b.name_uk AS b_uk FROM posts p LEFT JOIN boards b ON b.id = p.board_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.created_at DESC`,
    ...params,
  );
  let posts = rows.map((r: any) => ({ post: rowToPost(r), board: r.board_name ? boardDisplayName(r.board_name, r.board_key, getLang(), { ru: r.b_ru, en: r.b_en, uk: r.b_uk }) : '' }));
  if (q) {
    // SQLite LOWER() only folds ASCII, so filter in JS to handle Cyrillic properly.
    const terms = q.split(/\s+/).filter(Boolean);
    posts = posts.filter(({ post, board }) => {
      const hay = [post.aiTitle, post.title, post.summary, post.note, post.description, post.author, board, post.url, ...post.tags.map((t) => '#' + t)]
        .filter(Boolean).join(' \n ').toLowerCase();
      return terms.every((t) => hay.includes(t.replace(/^#/, '')));
    });
  }
  return posts.map((x) => x.post).filter((p) => markAllowed(p.mark, opts.mark ?? 'all'));
}

export async function setMark(id: number, mark: PostMark | null) {
  await updatePost(id, { mark });
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
  return rows.map((r) => ({ id: r.id, name: showName(r), key: r.key ?? null, emoji: r.emoji, createdAt: r.created_at, count: r.cnt, covers: byBoard.get(r.id) || [] }));
}

export async function boardNames(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM boards ORDER BY name');
  return rows.map((r) => showName(r));
}

/** Boards as the AI sees them: id, name in the UI language, all names, and the most frequent tags. */
export async function aiBoards(): Promise<AiBoard[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>('SELECT * FROM boards ORDER BY id');
  const tagRows = await db.getAllAsync<{ board_id: number; tags: string }>("SELECT board_id, tags FROM posts WHERE board_id IS NOT NULL AND status = 'done' ORDER BY created_at DESC LIMIT 1500");
  const freq = new Map<number, Map<string, number>>();
  const count = new Map<number, number>();
  for (const r of tagRows) {
    count.set(r.board_id, (count.get(r.board_id) ?? 0) + 1);
    let tags: string[] = [];
    try { tags = JSON.parse(r.tags || '[]'); } catch {}
    const m = freq.get(r.board_id) ?? new Map<string, number>();
    for (const t of tags) m.set(t, (m.get(t) ?? 0) + 1);
    freq.set(r.board_id, m);
  }
  return rows.map((r) => ({
    id: r.id, name: showName(r), key: r.key ?? null, nameRu: r.name_ru, nameEn: r.name_en, nameUk: r.name_uk,
    count: count.get(r.id) ?? 0,
    tags: r.key === 'misc' ? [] : [...(freq.get(r.id) ?? new Map()).entries()].filter(([, n]) => n >= 2 || (count.get(r.id) ?? 0) < 4).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t),
  }));
}

/** The Misc board's id (created on demand). */
export async function miscBoardId(): Promise<number> {
  return getOrCreateBoard(DEFAULT_BOARDS.misc.ru, DEFAULT_BOARDS.misc.emoji);
}

/** Board for an AI decision. New boards store all three names so they follow the UI language. */
export async function boardForChoice(choice: BoardChoice, emoji?: string | null): Promise<number> {
  if (choice.kind === 'existing') {
    const db = await getDb();
    if (await db.getFirstAsync('SELECT id FROM boards WHERE id = ?', choice.id)) return choice.id;
    return miscBoardId();
  }
  if (choice.kind === 'misc') return miscBoardId();
  const db = await getDb();
  const all = await db.getAllAsync<any>('SELECT * FROM boards');
  const named = all.map((r) => ({ id: r.id, name: r.name, key: r.key, nameRu: r.name_ru, nameEn: r.name_en, nameUk: r.name_uk }));
  for (const n of [choice.names.ru, choice.names.en, choice.names.uk]) {
    const ex = findBoardByName(n, named);
    if (ex) return ex.id;
  }
  const key = defaultBoardKey(choice.names.en) ?? defaultBoardKey(choice.names.ru);
  if (key) return getOrCreateBoard(DEFAULT_BOARDS[key].ru, emoji);
  const name = (choice.names[getLang()] || choice.names.en).slice(0, 40);
  const r = await db.runAsync('INSERT INTO boards (name, emoji, created_at, key, name_ru, name_en, name_uk, tr_done) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)',
    name, choice.emoji ?? emoji ?? null, Date.now(), choice.names.ru.slice(0, 40), choice.names.en.slice(0, 40), choice.names.uk.slice(0, 40), choice.partial ? 0 : 1);
  emitDataChanged();
  return Number(r.lastInsertRowId);
}

/** Keyless boards whose names were never translated (AI boards from before 1.10.0). */
export async function boardsNeedingTranslation(limit = 40): Promise<{ id: number; name: string }[]> {
  const db = await getDb();
  return db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM boards WHERE key IS NULL AND tr_done = 0 ORDER BY id LIMIT ?', limit);
}

export async function setBoardTranslations(id: number, tr: { ru: string; en: string; uk: string } | null) {
  const db = await getDb();
  // Only fill boards that are still untranslated: a rename in the meantime wins.
  if (tr) await db.runAsync('UPDATE boards SET name_ru = ?, name_en = ?, name_uk = ?, tr_done = 1 WHERE id = ? AND tr_done = 0 AND key IS NULL', tr.ru.slice(0, 40), tr.en.slice(0, 40), tr.uk.slice(0, 40), id);
  else await db.runAsync('UPDATE boards SET tr_done = 1 WHERE id = ? AND tr_done = 0', id);
  emitDataChanged();
}

export async function getOrCreateBoard(name: string, emoji?: string | null): Promise<number> {
  const db = await getDb();
  const clean = name.trim().slice(0, 40) || miscName(getLang());
  // Default boards are matched by key in any language, so "Misc" and "Разное" are one board.
  const key = defaultBoardKey(clean);
  let ex = (key ? await db.getFirstAsync<{ id: number; emoji: string | null }>('SELECT id, emoji FROM boards WHERE key = ?', key) : null)
    ?? await db.getFirstAsync<{ id: number; emoji: string | null }>('SELECT id, emoji FROM boards WHERE name = ?', key ? DEFAULT_BOARDS[key].ru : clean);
  if (!ex && !key) ex = await db.getFirstAsync<{ id: number; emoji: string | null }>('SELECT id, emoji FROM boards WHERE name_ru = ? COLLATE NOCASE OR name_en = ? COLLATE NOCASE OR name_uk = ? COLLATE NOCASE', clean, clean, clean);
  if (ex) {
    if (!ex.emoji && emoji) await db.runAsync('UPDATE boards SET emoji = ? WHERE id = ?', emoji, ex.id);
    return ex.id;
  }
  // Created by the user (or by name): it is their own wording, never machine-translated.
  const r = await db.runAsync('INSERT INTO boards (name, emoji, created_at, key, tr_done) VALUES (?, ?, ?, ?, 1)', key ? DEFAULT_BOARDS[key].ru : clean, emoji ?? (key ? DEFAULT_BOARDS[key].emoji : null), Date.now(), key);
  emitDataChanged();
  return Number(r.lastInsertRowId);
}

export async function renameBoard(id: number, name: string, emoji?: string | null) {
  const db = await getDb();
  const clean = name.trim().slice(0, 40);
  if (!clean) return;
  const dk = defaultBoardKey(clean);
  const other = (dk ? await db.getFirstAsync<{ id: number }>('SELECT id FROM boards WHERE key = ? AND id != ?', dk, id) : null)
    ?? await db.getFirstAsync<{ id: number }>('SELECT id FROM boards WHERE name = ? AND id != ?', clean, id);
  if (other) {
    // merging into an existing board
    await db.runAsync('UPDATE posts SET board_id = ? WHERE board_id = ?', other.id, id);
    await db.runAsync('DELETE FROM boards WHERE id = ?', id);
  } else {
    // A renamed board becomes the user's own: drop the key unless the name is unchanged.
    const cur = await db.getFirstAsync<any>('SELECT * FROM boards WHERE id = ?', id);
    const same = cur && showName(cur) === clean;
    if (same) await db.runAsync('UPDATE boards SET emoji = COALESCE(?, emoji) WHERE id = ?', emoji ?? null, id);
    // A real rename makes it the user's own board: their wording in every language, no auto-translation.
    else await db.runAsync('UPDATE boards SET name = ?, key = NULL, name_ru = NULL, name_en = NULL, name_uk = NULL, tr_done = 1, emoji = COALESCE(?, emoji) WHERE id = ?', clean, emoji ?? null, id);
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

/** Reminder candidates: never opened and not marked Done / Not important. */
export async function unopenedPosts(): Promise<Post[]> {
  const db = await getDb();
  const rows = await db.getAllAsync("SELECT * FROM posts WHERE opened_at IS NULL AND (mark IS NULL OR mark NOT IN ('done', 'skip')) ORDER BY created_at ASC");
  return rows.map(rowToPost);
}

/** Processed posts that still lack an embedding for the current model (backfill queue). */
export async function postsNeedingEmbedding(limit = 32): Promise<(Post & { boardName: string })[]> {
  const db = await getDb();
  const rows = await db.getAllAsync(
    `SELECT p.*, b.name AS board_name, b.key AS board_key, b.name_ru AS b_ru, b.name_en AS b_en, b.name_uk AS b_uk FROM posts p LEFT JOIN boards b ON b.id = p.board_id
     WHERE p.status = 'done' AND (p.embedding IS NULL OR p.embed_model IS NULL OR p.embed_model != ?)
     ORDER BY p.created_at DESC LIMIT ?`, EMBED_MODEL, limit,
  );
  return rows.map((r: any) => ({ ...rowToPost(r), boardName: r.board_name ? boardDisplayName(r.board_name, r.board_key, getLang(), { ru: r.b_ru, en: r.b_en, uk: r.b_uk }) : '' }));
}

export async function setEmbedding(id: number, packed: string | null) {
  const db = await getDb();
  // no emitDataChanged: invisible to the UI, avoids re-render storms during backfill
  await db.runAsync('UPDATE posts SET embedding = ?, embed_model = ? WHERE id = ?', packed, packed ? EMBED_MODEL : null, id);
}

/** Mark an embedding as stale (content changed). */
export async function clearEmbedding(id: number) {
  const db = await getDb();
  await db.runAsync('UPDATE posts SET embedding = NULL, embed_model = NULL WHERE id = ?', id);
}

/** Done posts in the Misc board (for «Разобрать Misc»), oldest first. */
export async function miscPosts(): Promise<Post[]> {
  const db = await getDb();
  const rows = await db.getAllAsync("SELECT p.* FROM posts p JOIN boards b ON b.id = p.board_id WHERE b.key = 'misc' AND p.status = 'done' ORDER BY p.created_at ASC");
  return rows.map(rowToPost);
}

/** Embedded, sorted posts per board (for centroids). Misc is excluded. */
export async function boardEmbeddings(): Promise<{ boardId: number; vec: number[] }[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    `SELECT p.id, p.board_id, p.embedding FROM posts p JOIN boards b ON b.id = p.board_id
     WHERE (b.key IS NULL OR b.key != 'misc') AND p.embed_model = ? AND p.embedding IS NOT NULL AND p.embedding != '[]'
     ORDER BY p.created_at DESC LIMIT 2000`, EMBED_MODEL,
  );
  return rows.map((r) => ({ boardId: r.board_id, vec: cachedVec(r.id, r.embedding) })).filter((x): x is { boardId: number; vec: number[] } => !!x.vec?.length);
}
