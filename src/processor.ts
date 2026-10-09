import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import { Directory, File, Paths } from 'expo-file-system';
import { analyzePost, AiError, isWeakText, sniffMime } from './core/ai';
import { fetchMetadata } from './core/metadata';
import type { Metadata } from './core/types';
import { detectPlatform, extraText, extractUrl, normalizeUrl } from './core/url';
import * as db from './db';

const API_KEY: string = (Constants.expoConfig?.extra as any)?.geminiApiKey || '';
export const hasApiKey = () => !!API_KEY;

export type SaveResult = { status: 'saved' | 'duplicate'; id: number } | { status: 'no-url' };

/** Save a shared link immediately (no network). AI/metadata happen in processQueue(). */
export async function saveShared(text: string | null | undefined, webUrl?: string | null, subject?: string | null): Promise<SaveResult> {
  const url = webUrl || extractUrl(text) || extractUrl(subject);
  if (!url) return { status: 'no-url' };
  const norm = normalizeUrl(url);
  const existing = await db.findPostByUrl(norm);
  if (existing) return { status: 'duplicate', id: existing.id };
  const extra = [subject && !subject.includes(url) ? subject : '', extraText(text, url)].filter(Boolean).join(' — ');
  const id = await db.insertPost({ url: norm, rawText: extra || null, platform: detectPlatform(norm) });
  return { status: 'saved', id };
}

function backoffMs(attempts: number) {
  // 1m, 2m, 4m ... capped at 3h
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 3 * 3600_000);
}

const thumbsDir = () => new Directory(Paths.document, 'thumbs');

async function cacheThumb(id: number, url: string): Promise<string | null> {
  try {
    const dir = thumbsDir();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const dest = new File(dir, `${id}.jpg`);
    const f = await File.downloadFileAsync(url, dest, { idempotent: true });
    return f.uri;
  } catch {
    return null;
  }
}

export function deleteThumb(id: number) {
  try { const f = new File(thumbsDir(), `${id}.jpg`); if (f.exists) f.delete(); } catch {}
}

let running: Promise<void> | null = null;

/** Process every pending post (metadata → thumbnail → Gemini). Safe to call often. */
export function processQueue(onlyId?: number): Promise<void> {
  if (running) return running.then(() => (onlyId ? processQueue(onlyId) : undefined));
  running = (async () => {
    try {
      for (let round = 0; round < 3; round++) {
        const list = await db.pendingPosts();
        const todo = onlyId ? list.filter((p) => p.id === onlyId) : list;
        if (!todo.length) break;
        for (const p of todo) await processOne(p);
        if (onlyId) break;
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

async function processOne(post: db.Post) {
  let p = post;
  let meta: Metadata = {
    url: p.url, platform: p.platform, title: p.title ?? undefined, description: p.description ?? undefined,
    author: p.author ?? undefined, image: p.image ?? undefined, blocked: p.metaBlocked, unavailable: p.unavailable, source: 'db',
  };
  if (!p.metaFetched) {
    const m = await fetchMetadata(p.url);
    // fetchMetadata never throws; if everything failed we may simply be offline → keep it for a retry,
    // but don't block the AI step forever: after 3 tries accept "blocked".
    if (m.blocked && p.attempts < 2 && !(await online())) {
      await db.updatePost(p.id, { attempts: p.attempts + 1, next_try_at: Date.now() + backoffMs(p.attempts + 1), last_error: 'Нет сети' });
      return;
    }
    meta = { ...m, url: p.url };
    const fields: Record<string, any> = {
      title: m.title ?? null, description: m.description ?? null, author: m.author ?? null, image: m.image ?? null,
      meta_fetched: 1, meta_blocked: m.blocked ? 1 : 0, unavailable: m.unavailable ? 1 : 0,
    };
    if (m.image) fields.local_image = await cacheThumb(p.id, m.image);
    p = { ...p, localImage: fields.local_image ?? p.localImage };
    await db.updatePost(p.id, fields);
  }
  if (!API_KEY) {
    await db.updatePost(p.id, { status: 'error', last_error: 'Нет ключа Gemini в сборке' });
    return;
  }
  try {
    const boards = await db.boardNames();
    const sharedText = p.rawText ?? undefined;
    const note = p.note ?? undefined;
    // Weak caption (emoji/hashtags only) → let Gemini look at the cached preview image.
    let image: { mimeType: string; data: string } | undefined;
    if (p.localImage && isWeakText(meta, sharedText, note)) {
      try { const data = await new File(p.localImage).base64(); image = { mimeType: sniffMime(data), data }; } catch {}
    }
    const ai = await analyzePost({ meta, sharedText, boards, image, note }, API_KEY);
    const boardId = await db.getOrCreateBoard(ai.board, ai.boardEmoji);
    const cur = await db.getPost(p.id);
    if (!cur) return; // deleted meanwhile
    await db.updatePost(p.id, {
      ai_title: ai.title ?? null, summary: ai.summary, tags: ai.tags,
      // keep a board the user picked manually while we were working
      board_id: cur.boardId ?? boardId,
      status: 'done', last_error: null, attempts: p.attempts + 1,
    });
  } catch (e: any) {
    const retryable = e instanceof AiError ? e.retryable : true;
    const attempts = p.attempts + 1;
    if (retryable && attempts < 12) {
      await db.updatePost(p.id, { attempts, next_try_at: Date.now() + backoffMs(attempts), last_error: String(e?.message || e).slice(0, 200) });
    } else {
      await db.updatePost(p.id, { status: 'error', attempts, last_error: String(e?.message || e).slice(0, 200) });
    }
  }
}

async function online(): Promise<boolean> {
  try {
    const s = await NetInfo.fetch();
    return s.isConnected !== false;
  } catch {
    return true;
  }
}

/** Re-run AI (and metadata) for one post, e.g. from the detail screen. */
export async function reprocess(id: number, refetchMeta = false) {
  await db.updatePost(id, { status: 'pending', next_try_at: 0, attempts: 0, last_error: null, ...(refetchMeta ? { meta_fetched: 0 } : {}) });
  await processQueue(id);
}

export async function retryAllNow() {
  const d = await db.getDb();
  await d.runAsync("UPDATE posts SET status = 'pending', next_try_at = 0 WHERE status != 'done'");
  await processQueue();
}
