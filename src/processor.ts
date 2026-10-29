import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import { analyzePost, AiError, isWeakText, sniffMime } from './core/ai';
import { fetchMetadata } from './core/metadata';
import type { Metadata } from './core/types';
import { detectPlatform, extraText, extractUrl, normalizeUrl } from './core/url';
import * as db from './db';
import { extractInstagram } from './core/igExtract';
import { igLoaderReady, loadInstagramPage } from './igSession';
import { getSettings, loadSettings } from './settings';
import { t } from './i18n';
import { EmbedError, embedText, embedTexts, packVec, rankByVector } from './core/embed';

import { aiMode, getGeminiAuth } from './aiAuth';
import { canUseGemini } from './core/gemini';
export const hasApiKey = () => aiMode() !== 'none';

/** Friendly text for our proxy's daily limit. */
function limitMessage(scope: 'device' | 'global') {
  return scope === 'device'
    ? t('Дневной лимит ИИ исчерпан. Пост опишется завтра, или добавь свой ключ Gemini в настройках')
    : t('Бесплатный ИИ-сервер сегодня перегружен. Пост опишется позже, или добавь свой ключ Gemini в настройках');
}

export type SaveResult = { status: 'saved' | 'duplicate'; id: number } | { status: 'no-url' };

/** Save a shared link immediately (no network). AI/metadata happen in processQueue(). */
export async function saveShared(text: string | null | undefined, webUrl?: string | null, subject?: string | null, initial?: { note?: string | null; boardId?: number | null }): Promise<SaveResult> {
  const url = webUrl || extractUrl(text) || extractUrl(subject);
  if (!url) return { status: 'no-url' };
  const norm = normalizeUrl(url);
  const existing = await db.findPostByUrl(norm);
  if (existing) return { status: 'duplicate', id: existing.id };
  const extra = [subject && !subject.includes(url) ? subject : '', extraText(text, url)].filter(Boolean).join(' — ');
  const id = await db.insertPost({ url: norm, rawText: extra || null, platform: detectPlatform(norm), note: initial?.note, boardId: initial?.boardId });
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

/** Yield to the UI: wait until animations/gestures settle so background work never competes with a scroll. */
const idle = () => new Promise<void>((r) => { try { require('react-native').InteractionManager.runAfterInteractions(() => setTimeout(r, 16)); } catch { r(); } });

/** Process every pending post (metadata → thumbnail → Gemini). Safe to call often. */
export function processQueue(onlyId?: number): Promise<void> {
  if (running) return running.then(() => (onlyId ? processQueue(onlyId) : undefined));
  running = (async () => {
    try {
      await loadSettings();
      for (let round = 0; round < 3; round++) {
        const list = await db.pendingPosts();
        const todo = onlyId ? list.filter((p) => p.id === onlyId) : list;
        if (!todo.length) break;
        for (const p of todo) { await idle(); await processOne(p); }
        if (onlyId) break;
      }
      await idle();
      await backfillEmbeddings();
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
    let m = await fetchMetadata(p.url);
    // fetchMetadata never throws; if everything failed we may simply be offline → keep it for a retry,
    // but don't block the AI step forever: after 3 tries accept "blocked".
    if (m.blocked && p.attempts < 2 && !(await online())) {
      await db.updatePost(p.id, { attempts: p.attempts + 1, next_try_at: Date.now() + backoffMs(p.attempts + 1), last_error: t('Нет сети') });
      return;
    }
    meta = { ...m, url: p.url };
    // Private / login-only Instagram post → read it through the user's own session (hidden WebView).
    const st = getSettings();
    if (m.platform === 'instagram' && st.igConnected && (m.unavailable || m.blocked || isWeakText(m))) {
      if (!igLoaderReady()) {
        if (p.attempts < 3) { // app UI not mounted (e.g. background) → try again a bit later
          await db.updatePost(p.id, { attempts: p.attempts + 1, next_try_at: Date.now() + 60_000, last_error: t('Жду Instagram-сессию') });
          return;
        }
      } else {
        try {
          const raw = await loadInstagramPage(p.url);
          const ig = extractInstagram(raw);
          if (ig && (ig.caption || ig.image)) {
            meta = {
              ...meta, blocked: false, unavailable: false, source: 'ig-session:' + ig.source,
              description: ig.caption || meta.description, author: ig.author || meta.author,
              title: meta.title || (ig.author ? `${ig.authorName ? ig.authorName + ' ' : ''}(${ig.author}) · Instagram` : meta.title),
              image: ig.image || meta.image,
            };
          }
        } catch { /* fall back to whatever we have */ }
      }
    }
    m = meta;
    const fields: Record<string, any> = {
      title: m.title ?? null, description: m.description ?? null, author: m.author ?? null, image: m.image ?? null,
      meta_fetched: 1, meta_blocked: m.blocked ? 1 : 0, unavailable: m.unavailable ? 1 : 0,
    };
    if (m.image) fields.local_image = await cacheThumb(p.id, m.image);
    p = { ...p, localImage: fields.local_image ?? p.localImage };
    await db.updatePost(p.id, fields);
  }
  const st = getSettings();
  if (!st.aiEnabled) {
    const cur = await db.getPost(p.id);
    await db.updatePost(p.id, { status: 'done', last_error: null, board_id: cur?.boardId ?? st.defaultBoardId ?? null });
    return;
  }
  const auth = await getGeminiAuth();
  if (!canUseGemini(auth)) {
    await db.updatePost(p.id, { status: 'error', last_error: t('Нет ключа Gemini в сборке') });
    return;
  }
  try {
    const boards = await db.boardNames();
    const sharedText = p.rawText ?? undefined;
    const note = p.note ?? undefined;
    // Weak caption (emoji/hashtags only) → let Gemini look at the cached preview image.
    let image: { mimeType: string; data: string } | undefined;
    if (st.aiVision && p.localImage && isWeakText(meta, sharedText, note)) {
      try { const data = await new File(p.localImage).base64(); image = { mimeType: sniffMime(data), data }; } catch {}
    }
    const ai = await analyzePost({ meta, sharedText, boards, image, note, lang: st.aiLang }, auth);
    const defaultBoard = st.defaultBoardId != null && (await db.listBoards()).some((b) => b.id === st.defaultBoardId) ? st.defaultBoardId : null;
    const boardId = defaultBoard ?? (await db.getOrCreateBoard(ai.board, ai.boardEmoji));
    const cur = await db.getPost(p.id);
    if (!cur) return; // deleted meanwhile
    await db.updatePost(p.id, {
      ai_title: ai.title ?? null, summary: ai.summary, tags: ai.tags,
      // keep a board the user picked manually while we were working
      board_id: cur.boardId ?? boardId,
      status: 'done', last_error: null, attempts: p.attempts + 1,
    });
    await db.clearEmbedding(p.id); // content changed → (re)embed in backfillEmbeddings()
  } catch (e: any) {
    if (e instanceof AiError && e.limit) {
      // Not the post's fault: wait for the daily reset without burning attempts.
      await db.updatePost(p.id, { next_try_at: Date.now() + e.limit.retryAfterSec * 1000 + 60_000, last_error: limitMessage(e.limit.scope) });
      return;
    }
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

/** After connecting Instagram: re-read every IG post that was unavailable / had no metadata. */
export async function reprocessInstagramUnavailable(): Promise<number> {
  const d = await db.getDb();
  const r = await d.runAsync("UPDATE posts SET status = 'pending', meta_fetched = 0, next_try_at = 0, attempts = 0, last_error = NULL WHERE platform = 'instagram' AND (unavailable = 1 OR meta_blocked = 1)");
  if (r.changes) processQueue();
  return r.changes;
}

export async function countInstagramUnavailable(): Promise<number> {
  const d = await db.getDb();
  const r = await d.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM posts WHERE platform = 'instagram' AND (unavailable = 1 OR meta_blocked = 1)");
  return r?.n ?? 0;
}

/** Delete cached preview images (they are re-downloaded on demand by "Переописать"). */
export async function clearThumbCache() {
  try { const dir = thumbsDir(); if (dir.exists) dir.delete(); } catch {}
  const d = await db.getDb();
  await d.runAsync('UPDATE posts SET local_image = NULL');
}

let embedPausedUntil = 0;

/**
 * Compute missing embeddings in batches (new posts + existing posts after upgrading to 1.3.0).
 * Best effort: any failure just pauses the backfill; search falls back to plain text.
 */
export async function backfillEmbeddings(maxBatches = 5): Promise<number> {
  if (!getSettings().aiEnabled || Date.now() < embedPausedUntil) return 0;
  const auth = await getGeminiAuth();
  if (!canUseGemini(auth)) return 0;
  let done = 0;
  for (let b = 0; b < maxBatches; b++) {
    const todo = await db.postsNeedingEmbedding(32);
    if (!todo.length) break;
    const withText = todo.map((p) => ({ p, text: embedText({ ...p, board: p.boardName }) }));
    for (const x of withText.filter((x) => !x.text)) await db.setEmbedding(x.p.id, '[]'); // nothing to embed; don't retry forever
    const real = withText.filter((x) => x.text);
    if (!real.length) continue;
    try {
      const vecs = await embedTexts(real.map((x) => x.text), auth, 'RETRIEVAL_DOCUMENT');
      for (let i = 0; i < real.length; i++) await db.setEmbedding(real[i].p.id, packVec(vecs[i]));
      done += real.length;
    } catch (e: any) {
      embedPausedUntil = Date.now() + (e instanceof EmbedError && e.status === 429 ? 10 * 60_000 : 2 * 60_000);
      break;
    }
  }
  return done;
}

/**
 * Natural-language search over the given posts. Returns null when semantic search isn't
 * possible (no key, offline, API error, nothing embedded yet) so the caller falls back to text search.
 */
export async function semanticSearch(query: string, posts: db.Post[]): Promise<db.Post[] | null> {
  const q = query.trim();
  if (!q || !posts.some((p) => p.embedding?.length)) return null;
  try {
    const auth = await getGeminiAuth();
    if (!canUseGemini(auth)) return null;
    const [vec] = await embedTexts([q], auth, 'RETRIEVAL_QUERY', 8000);
    return rankByVector(vec, posts, { limit: 60 }).map((x) => x.post);
  } catch {
    return null;
  }
}
