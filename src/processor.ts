import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import { analyzePost, AiError, isWeakText, shouldSendImage, sniffMime, translateBoardNames } from './core/ai';
import { boardEmbedText, centroid, EMBED_PICK, LOW_CONFIDENCE, pickBoard, pickBoardByEmbedding, prepareBoardVectors, type AiBoard, type BoardChoice, type BoardVector } from './core/sorting';
import { fetchMetadata } from './core/metadata';
import type { Metadata } from './core/types';
import { detectPlatform, extraText, extractUrl, normalizeUrl } from './core/url';
import * as db from './db';
import { extractInstagram } from './core/igExtract';
import { igLoaderReady, loadInstagramPage } from './igSession';
import { getSettings, loadSettings } from './settings';
import { getLang, t } from './i18n';
import { EmbedError, embedText, embedTexts, packVec, rankByVector } from './core/embed';

import { aiMode, getGeminiAuth } from './aiAuth';
import { canUseGemini } from './core/gemini';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/**
 * Re-encode the preview as JPEG so it stays well under the proxy's 1.5 MB image cap.
 * `maxWidth` 1080 for screenshots (small text must stay readable); 768 for covers/frames, where the subject is
 * what matters and a smaller picture costs fewer tokens.
 */
async function aiImage(uri: string, maxWidth = 1080): Promise<{ mimeType: string; data: string } | undefined> {
  try {
    const src = uri.startsWith('file:') || uri.includes('://') ? uri : `file://${uri}`;
    const info = await manipulateAsync(src, []);
    const actions = info.width > maxWidth ? [{ resize: { width: maxWidth } }] : [];
    const r = await manipulateAsync(src, actions, { compress: 0.8, format: SaveFormat.JPEG, base64: true });
    if (r.base64 && r.base64.length * 0.75 < 1_400_000) return { mimeType: 'image/jpeg', data: r.base64 };
  } catch {}
  try {
    const data = await new File(uri).base64();
    const mimeType = sniffMime(data);
    if (data.length * 0.75 < 1_400_000 && mimeType !== 'image/gif') return { mimeType, data };
  } catch {}
  return undefined;
}
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
  try { const f = new File(thumbsDir(), `${id}-shot.jpg`); if (f.exists) f.delete(); } catch {}
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
      await translateLegacyBoards().catch(() => {});
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
    if (m.image && !p.shot) fields.local_image = await cacheThumb(p.id, m.image);
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
    const boards = await db.aiBoards();
    const sharedText = p.rawText ?? undefined;
    const note = p.note ?? undefined;
    // Weak caption (emoji/hashtags only) → let Gemini look at the cached preview image.
    let image: { mimeType: string; data: string } | undefined;
    if (p.localImage && shouldSendImage({ hasImage: true, shot: !!p.shot, aiVision: st.aiVision, meta, sharedText, note })) {
      image = await aiImage(p.localImage, p.shot ? 1080 : 768);
    }
    const ai = await analyzePost({ meta, sharedText, boards, image, note, lang: st.aiLang, boardLang: getLang() }, auth);
    let choice: BoardChoice = ai.choice ?? { kind: 'misc', confidence: 0, reason: 'ai' };
    choice = await embeddingFallback(choice, boards, { ...p, aiTitle: ai.title ?? null, summary: ai.summary, tags: ai.tags, description: meta.description ?? null, author: meta.author ?? null }, auth);
    const defaultBoard = st.defaultBoardId != null && (await db.listBoards()).some((b) => b.id === st.defaultBoardId) ? st.defaultBoardId : null;
    const boardId = defaultBoard ?? (await db.boardForChoice(choice, ai.boardEmoji));
    const cur = await db.getPost(p.id);
    if (!cur) return; // deleted meanwhile
    const miscId = boards.find((b) => b.key === 'misc')?.id;
    // Keep a board the user picked (manually or while we were working); only an auto-placement
    // in Misc (or no board yet) is replaced by the new decision.
    const replace = cur.boardId == null || (cur.boardId === p.boardId && (p.needsResort || cur.boardId === miscId));
    await db.updatePost(p.id, {
      ai_title: ai.title ?? null, summary: ai.summary, tags: ai.tags,
      board_id: replace ? boardId : cur.boardId,
      needs_resort: choice.kind === 'misc' && choice.reason === 'forced' && !defaultBoard ? 1 : 0,
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

/** Pseudo-URL for a post that was created from a screenshot alone (no link). */
export const SHOT_URL_PREFIX = 'grabbit://shot/';
export const isShotUrl = (u: string) => u.startsWith(SHOT_URL_PREFIX);

/**
 * Attach a screenshot (file:// or content:// URI) to a post: it becomes the preview and the AI
 * reads it even if the post itself is closed. Re-runs the AI step.
 */
export async function attachScreenshot(id: number, uri: string): Promise<void> {
  const dir = thumbsDir();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, `${id}-shot.jpg`);
  if (dest.exists) dest.delete();
  new File(uri).copy(dest);
  await db.updatePost(id, { local_image: dest.uri, shot: 1, status: 'pending', attempts: 0, next_try_at: 0, last_error: null });
  await db.clearEmbedding(id);
  processQueue(id).catch(() => {});
}

/** Save a shared screenshot: to the post whose link came along, or as a new post of its own. */
export async function saveScreenshot(uri: string, text?: string | null): Promise<{ id: number; status: 'saved' | 'attached' }> {
  const url = extractUrl(text);
  let id: number;
  let status: 'saved' | 'attached' = 'saved';
  if (url) {
    const r = await saveShared(text, null, null);
    if (r.status === 'no-url') throw new Error('no-url');
    id = r.id; if (r.status === 'duplicate') status = 'attached';
  } else {
    id = await db.insertPost({ url: SHOT_URL_PREFIX + Date.now(), rawText: text?.trim() || null, platform: 'web', title: t('Скриншот') });
    await db.updatePost(id, { meta_fetched: 1, meta_blocked: 1 });
  }
  await attachScreenshot(id, uri);
  return { id, status };
}

/** Most recent closed post (candidate for "attach this screenshot to…"). */
export async function latestClosedPost(): Promise<db.Post | null> {
  const d = await db.getDb();
  const r = await d.getFirstAsync<{ id: number }>("SELECT id FROM posts WHERE (unavailable = 1 OR meta_blocked = 1) AND shot = 0 AND created_at > ? ORDER BY created_at DESC LIMIT 1", Date.now() - 3 * 86400_000);
  return r ? db.getPost(r.id) : null;
}

// ---------- Board sorting helpers (1.10.0) ----------

/** board text → name embedding; recomputed only when a board's name/tags change. */
const nameVecCache = new Map<string, number[]>();

/** Centroids for boards with enough embedded posts, name embeddings for the rest. Misc never competes. */
async function boardVectors(boards: AiBoard[], auth: Awaited<ReturnType<typeof getGeminiAuth>>): Promise<BoardVector[]> {
  const byBoard = new Map<number, number[][]>();
  for (const e of await db.boardEmbeddings()) { const a = byBoard.get(e.boardId) ?? []; if (a.length < 60) a.push(e.vec); byBoard.set(e.boardId, a); }
  const out: BoardVector[] = [];
  const needName: { b: AiBoard; text: string }[] = [];
  for (const b of boards) {
    if (b.key === 'misc') continue;
    const vs = byBoard.get(b.id) ?? [];
    const c = vs.length >= EMBED_PICK.minPosts ? centroid(vs) : null;
    if (c) { out.push({ id: b.id, vec: c, kind: 'centroid' }); continue; }
    const text = boardEmbedText(b);
    const hit = nameVecCache.get(text);
    if (hit) out.push({ id: b.id, vec: hit, kind: 'name' }); else needName.push({ b, text });
  }
  if (needName.length) {
    try {
      const vecs = await embedTexts(needName.map((x) => x.text), auth, 'RETRIEVAL_DOCUMENT');
      needName.forEach((x, i) => { nameVecCache.set(x.text, vecs[i]); out.push({ id: x.b.id, vec: vecs[i], kind: 'name' }); });
    } catch { /* best effort: centroids only */ }
  }
  return out;
}

/**
 * If the AI left the post in Misc (but the post isn't simply closed) or was unsure, see whether its
 * embedding clearly belongs to one of the existing boards. One embedding request, no extra analysis.
 */
async function embeddingFallback(choice: BoardChoice, boards: AiBoard[], post: Parameters<typeof embedText>[0], auth: Awaited<ReturnType<typeof getGeminiAuth>>, vec?: number[] | null): Promise<BoardChoice> {
  const unsure = choice.kind === 'misc' ? choice.reason !== 'forced' : choice.kind === 'existing' && choice.confidence < LOW_CONFIDENCE;
  if (!unsure || Date.now() < embedPausedUntil) return choice;
  try {
    let v = vec ?? null;
    if (!v) {
      const text = embedText({ ...post, board: null });
      if (!text) return choice;
      [v] = await embedTexts([text], auth, 'RETRIEVAL_DOCUMENT');
    }
    const cands = await boardVectors(boards, auth);
    const pick = pickBoardByEmbedding(v, cands);
    if (pick && !(choice.kind === 'existing' && choice.id === pick.id)) return { kind: 'existing', id: pick.id, confidence: Math.max(choice.confidence, 0.5) };
  } catch (e: any) {
    if (e instanceof EmbedError && e.status === 429) embedPausedUntil = Date.now() + 10 * 60_000;
  }
  return choice;
}

let lastTranslateTry = 0;

/** One-off: give the user's/AI boards created before 1.10.0 names in RU/EN/UK (one AI request). */
export async function translateLegacyBoards(): Promise<number> {
  if (Date.now() - lastTranslateTry < 30 * 60_000 || !getSettings().aiEnabled) return 0;
  const todo = await db.boardsNeedingTranslation(40);
  if (!todo.length) return 0;
  const auth = await getGeminiAuth();
  if (!canUseGemini(auth)) return 0;
  lastTranslateTry = Date.now(); // at most one batch every 30 min
  try {
    const tr = await translateBoardNames(todo, auth);
    for (const b of todo) await db.setBoardTranslations(b.id, tr.get(b.id) ?? null);
    return tr.size;
  } catch {
    return 0; // limit / offline: try again on the next start
  }
}

export interface ResortProgress { done: number; total: number; moved: number }
export interface ResortResult { moved: number; checked: number; left: number; waiting: number; limited: 'device' | 'global' | null }

/** Max AI requests per «Разобрать Misc» tap: keeps well inside the proxy's per-minute and daily limits. */
export const RESORT_AI_BATCH = 15;

/**
 * «Разобрать Misc»: first a free pass by embeddings, then up to RESORT_AI_BATCH posts through the AI.
 * Closed posts without content stay (they're re-sorted automatically once they get a note/screenshot/IG login).
 * Only the board changes; title/summary/tags are kept.
 */
export async function resortMisc(onProgress?: (p: ResortProgress) => void): Promise<ResortResult> {
  await loadSettings();
  const auth = await getGeminiAuth();
  const posts = await db.miscPosts();
  const waiting = posts.filter((p) => p.needsResort).length;
  const todo = posts.filter((p) => !p.needsResort);
  const res: ResortResult = { moved: 0, checked: 0, left: 0, waiting, limited: null };
  if (!todo.length || !canUseGemini(auth)) { res.left = todo.length; return res; }
  const total = todo.length;
  const report = () => onProgress?.({ done: res.checked, total, moved: res.moved });
  report();
  let boards = await db.aiBoards();
  // 1) embeddings (already computed for most posts)
  const prep = prepareBoardVectors(await boardVectors(boards, auth)); // centered once, reused for every post
  const rest: db.Post[] = [];
  for (const p of todo) {
    const pick = p.embedding?.length ? pickBoard(p.embedding, prep) : null;
    if (pick) { await db.updatePost(p.id, { board_id: pick.id }); await db.clearEmbedding(p.id); res.moved++; res.checked++; report(); }
    else rest.push(p);
  }
  // 2) AI, in a small batch
  let used = 0;
  for (const p of rest) {
    if (used >= RESORT_AI_BATCH) break;
    used++;
    await idle();
    try {
      const meta: Metadata = { url: p.url, platform: p.platform, title: p.title ?? undefined, description: p.description ?? undefined, author: p.author ?? undefined, blocked: p.metaBlocked, unavailable: p.unavailable, source: 'db' };
      const sharedText = p.rawText ?? undefined, note = p.note ?? undefined;
      // Same rule as for a new post: a thin caption means the picture decides. (Before 1.10.1 «Разобрать» never sent it.)
      const image = p.localImage && shouldSendImage({ hasImage: true, shot: !!p.shot, aiVision: getSettings().aiVision, meta, sharedText, note })
        ? await aiImage(p.localImage, p.shot ? 1080 : 768) : undefined;
      const ai = await analyzePost({ meta, sharedText, note, boards, image, lang: getSettings().aiLang, boardLang: getLang() }, auth);
      let choice = ai.choice ?? { kind: 'misc', confidence: 0, reason: 'ai' } as BoardChoice;
      choice = await embeddingFallback(choice, boards, p, auth, p.embedding);
      if (choice.kind !== 'misc') {
        const id = await db.boardForChoice(choice, ai.boardEmoji);
        const cur = await db.getPost(p.id);
        if (cur && cur.boardId === p.boardId) { await db.updatePost(p.id, { board_id: id }); await db.clearEmbedding(p.id); res.moved++; }
        if (choice.kind === 'new') boards = await db.aiBoards();
      }
    } catch (e: any) {
      if (e instanceof AiError && e.limit) { res.limited = e.limit.scope; break; }
      if (e instanceof AiError && !e.retryable) break;
    }
    res.checked++;
    report();
    await new Promise((r) => setTimeout(r, 1200)); // stay under the proxy's per-minute limit
  }
  res.left = Math.max(0, total - res.checked);
  backfillEmbeddings().catch(() => {});
  return res;
}
