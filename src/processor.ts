import NetInfo from '@react-native-community/netinfo';
import { Directory, File, Paths } from 'expo-file-system';
import { analyzeDetailedText, analyzePost, AiError, isOpaque, isWeakText, shouldSendImage, sniffMime, translateBoardNames } from './core/ai';
import { boardEmbedText, centroid, EMBED_PICK, LOW_CONFIDENCE, pickBoardByEmbedding, type AiBoard, type BoardChoice, type BoardVector } from './core/sorting';
import { summarySources, type DetailSource } from './core/analysisSources';
import { fetchArticleText, fetchMetadata } from './core/metadata';
import { createPostQueue } from './core/postQueue';
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

/** Let save feedback render before starting work. */
const idle = () => new Promise<void>((resolve) => setTimeout(resolve, 16));

let maintenance: Promise<void> | null = null;
const runPostQueue = createPostQueue(
  (id) => db.nextPendingPost(Date.now(), id),
  async (post) => { await idle(); await processOne(post); },
  () => {
    if (maintenance) return;
    maintenance = (async () => {
      await idle();
      await backfillEmbeddings();
      await translateLegacyBoards();
    })().catch(() => {}).finally(() => { maintenance = null; });
  },
);

/** Process a shared/retried post ahead of the backlog. Search indexing runs independently. */
export async function processQueue(onlyId?: number): Promise<void> {
  await loadSettings();
  return runPostQueue(onlyId);
}

function savedMetadata(post: db.Post): Metadata {
  return { url: post.url, platform: post.platform, title: post.title ?? undefined,
    description: post.description ?? undefined, author: post.author ?? undefined, image: post.image ?? undefined,
    blocked: post.metaBlocked, unavailable: post.unavailable, source: 'db' };
}

function needsInstagramSession(meta: Metadata) {
  return meta.platform === 'instagram' && getSettings().igConnected && (meta.unavailable || meta.blocked || isWeakText(meta));
}

async function enrichInstagram(meta: Metadata): Promise<Metadata> {
  try {
    const ig = extractInstagram(await loadInstagramPage(meta.url));
    if (ig && (ig.caption || ig.image)) return {
      ...meta, blocked: false, unavailable: false, source: 'ig-session:' + ig.source,
      description: ig.caption || meta.description, author: ig.author || meta.author,
      title: meta.title || (ig.author ? [ig.authorName, '(' + ig.author + ')'].filter(Boolean).join(' ') + ' · Instagram' : undefined), image: ig.image || meta.image,
    };
  } catch {}
  return meta;
}

function metadataFields(meta: Metadata) {
  return { title: meta.title ?? null, description: meta.description ?? null, author: meta.author ?? null, image: meta.image ?? null,
    meta_fetched: 1, meta_blocked: Number(!!meta.blocked), unavailable: Number(!!meta.unavailable) };
}

async function processOne(post: db.Post) {
  let p = post;
  let meta = savedMetadata(p);
  if (!p.metaFetched) {
    let m = await fetchMetadata(p.url);
    // fetchMetadata never throws; if everything failed we may simply be offline → keep it for a retry,
    // but don't block the AI step forever: after 3 tries accept "blocked".
    if (m.blocked && p.attempts < 2 && !(await online())) {
      await db.updatePost(p.id, { attempts: p.attempts + 1, next_try_at: Date.now() + backoffMs(p.attempts + 1), last_error: t('Нет сети') });
      return;
    }
    meta = { ...m, url: p.url };
    if (needsInstagramSession(meta)) {
      if (igLoaderReady()) meta = await enrichInstagram(meta);
      else if (p.attempts < 3) {
        await db.updatePost(p.id, { attempts: p.attempts + 1, next_try_at: Date.now() + 60_000, last_error: t('Жду Instagram-сессию') });
        return;
      }
    }
    m = meta;
    const fields: Record<string, any> = metadataFields(m);
    if (m.image && !p.shot) fields.local_image = await cacheThumb(p.id, m.image);
    p = { ...p, localImage: fields.local_image ?? p.localImage };
    await db.updatePost(p.id, fields);
  }
  const st = getSettings();
  if (!st.aiEnabled) {
    const defaultBoardId = st.defaultBoardId != null && await db.boardExists(st.defaultBoardId) ? st.defaultBoardId : null;
    await db.updatePost(p.id, { status: 'done', last_error: null },
      p.boardId == null ? { from: null, to: defaultBoardId, needsResort: false } : undefined);
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
    const current = await db.getPost(p.id);
    if (!current) return;
    const miscId = boards.find((board) => board.key === 'misc')?.id;
    const shouldPlace = current.boardId === p.boardId && (current.boardId == null || (current.needsResort && current.boardId === miscId));
    let placement: { from: number | null; to: number; needsResort: boolean } | undefined;
    if (shouldPlace) {
      const defaultBoard = st.defaultBoardId != null && await db.boardExists(st.defaultBoardId) ? st.defaultBoardId : null;
      let choice: BoardChoice = ai.choice ?? { kind: 'misc', confidence: 0, reason: 'ai' };
      if (defaultBoard == null) {
        choice = await embeddingFallback(choice, boards, { ...p, aiTitle: ai.title ?? null, summary: ai.summary, tags: ai.tags, description: meta.description ?? null, author: meta.author ?? null }, auth);
      }
      placement = {
        from: current.boardId,
        to: defaultBoard ?? await db.boardForChoice(choice, ai.boardEmoji),
        needsResort: defaultBoard == null && choice.kind === 'misc' && choice.reason === 'forced',
      };
    }
    await db.updatePost(p.id, {
      ai_title: ai.title ?? null, summary: ai.summary, tags: ai.tags, summary_sources: summarySources({ meta, sharedText, note, image, shot: p.shot }),
      status: 'done', last_error: null, attempts: p.attempts + 1,
    }, placement);
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

/**
 * «Вернуть» after «Разобрать»: puts the moved posts back (only those the user hasn't moved again since)
 * and removes boards the run created if they ended up empty. Returns how many posts went back.
 */
export async function undoResort(r: Pick<ResortResult, 'moves' | 'newBoards'>): Promise<number> {
  let n = 0;
  for (const m of r.moves) {
    const cur = await db.getPost(m.postId);
    if (cur && await db.updatePost(m.postId, { board_id: m.from }, undefined, { boardId: m.to })) { await db.clearEmbedding(m.postId); n++; }
  }
  if (r.newBoards.length) {
    const empty = new Set((await db.listBoards()).filter((b) => b.count === 0).map((b) => b.id));
    for (const id of r.newBoards) if (empty.has(id)) await db.deleteBoard(id);
  }
  backfillEmbeddings().catch(() => {});
  return n;
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

export async function describePostInDepth(post: db.Post, transcript?: string): Promise<'saved' | 'no-source' | 'no-ai'> {
  await loadSettings();
  const auth = await getGeminiAuth();
  if (!canUseGemini(auth)) return 'no-ai';
  const supplied = transcript?.trim();
  const source: DetailSource = supplied ? 'transcript' : 'article';
  const text = supplied || (post.platform === 'web' && /^https?:/i.test(post.url) ? await fetchArticleText(post.url) : null);
  if (!text || text.length < 40) return 'no-source';
  const result = await analyzeDetailedText(text, source, auth, getSettings().aiLang);
  const saved = await db.updatePost(post.id, { detailed_summary: result, detail_source: source });
  if (!saved) throw new Error('Post removed during analysis');
  return 'saved';
}

export interface ResortProgress { done: number; total: number; moved: number }
export interface ResortMove { postId: number; from: number | null; to: number }
export interface ResortResult {
  noAi?: boolean;
  moved: number; checked: number; left: number; waiting: number; limited: 'device' | 'global' | null;
  /** What «Вернуть» needs: every move, and boards this run created. */
  moves: ResortMove[]; newBoards: number[];
}

// Bound manual work so a batch stays responsive and shares the existing AI quota.
const RESORT_AI_BATCH = 8;
let activeResort: Promise<ResortResult> | null = null;

export function resortMisc(onProgress?: (p: ResortProgress) => void): Promise<ResortResult> {
  if (activeResort) return activeResort;
  activeResort = runMiscSort(onProgress).finally(() => { activeResort = null; });
  return activeResort;
}

async function runMiscSort(onProgress?: (p: ResortProgress) => void): Promise<ResortResult> {
  await loadSettings();
  const auth = await getGeminiAuth();
  const posts = await db.miscPosts();
  const res: ResortResult = { moved: 0, checked: 0, left: 0, waiting: 0, limited: null, moves: [], newBoards: [] };
  if (!posts.length || !canUseGemini(auth)) { res.left = posts.length; res.noAi = !!posts.length; return res; }
  let boards = await db.aiBoards();
  const batch = posts.slice(0, RESORT_AI_BATCH);
  const report = () => onProgress?.({ done: res.checked, total: batch.length, moved: res.moved });
  report();
  for (const post of batch) {
    await idle();
    try {
      let meta = savedMetadata(post);
      const sharedText = post.rawText ?? undefined;
      const note = post.note ?? undefined;
      if (!isShotUrl(post.url) && (post.needsResort || meta.blocked || meta.unavailable || isWeakText(meta, sharedText, note))) {
        let fresh = { ...await fetchMetadata(post.url), url: post.url };
        if (needsInstagramSession(fresh) && igLoaderReady()) fresh = await enrichInstagram(fresh);
        if (!fresh.blocked && !fresh.unavailable) {
          meta = { ...fresh, title: fresh.title ?? meta.title, description: fresh.description ?? meta.description, image: fresh.image ?? meta.image };
        }
      }
      const useImage = shouldSendImage({ hasImage: !!(post.localImage || meta.image), shot: !!post.shot, aiVision: getSettings().aiVision, meta, sharedText, note });
      const imageUrl = useImage && meta.image && meta.image !== post.image && !post.shot ? await cacheThumb(post.id, meta.image) : null;
      const local = imageUrl ?? post.localImage ?? (useImage && meta.image ? await cacheThumb(post.id, meta.image) : null);
      const image = useImage && local ? await aiImage(local, post.shot ? 1080 : 768) : undefined;
      const input = { meta, sharedText, note, image, boards, lang: getSettings().aiLang, boardLang: getLang() };
      const sources = summarySources({ ...input, shot: post.shot });
      const weak = isWeakText(meta, sharedText, note);
      const titleCanDescribeContent = !!meta.title && ['web', 'youtube', 'reddit', 'github'].includes(meta.platform);
      const hasText = !!(meta.description?.trim() || sharedText?.trim() || note?.trim());
      const noEvidence = (!image && !hasText && (!titleCanDescribeContent || meta.blocked || meta.unavailable)) || isOpaque(input);
      if (noEvidence) {
        res.waiting++;
        await db.updatePost(post.id, { misc_checked_at: Date.now() }, undefined, { boardId: post.boardId, ready: true });
      } else {
        const ai = await analyzePost(input, auth);
        const initial = ai.choice ?? { kind: 'misc', confidence: 0, reason: 'ai' };
        const choice = await embeddingFallback(initial, boards, { ...post, aiTitle: ai.title ?? null, summary: ai.summary, tags: ai.tags, description: meta.description ?? null }, auth);
        // Leave weak guesses in Misc, even when the model proposed a board.
        const credible = choice.kind === 'existing' ? choice.confidence >= 0.65 || choice !== initial :
          choice.kind === 'new' && choice.confidence >= 0.78;
        const target = credible ? await db.boardForChoice(choice, ai.boardEmoji) : post.boardId;
        const moved = target !== post.boardId && target != null;
        if (moved && !boards.some((board) => board.id === target)) {
          res.newBoards.push(target);
          boards = await db.aiBoards();
        }
        const updated = await db.updatePost(post.id, {
          ...metadataFields(meta), ...(local ? { local_image: local } : {}),
          ai_title: ai.title ?? null, summary: ai.summary, tags: ai.tags, summary_sources: sources,
          misc_checked_at: Date.now(), board_id: target, needs_resort: Number(!moved && weak && !image), status: 'done', last_error: null,
        }, undefined, { boardId: post.boardId, ready: true });
        if (updated) {
          await db.clearEmbedding(post.id);
          if (moved) { res.moves.push({ postId: post.id, from: post.boardId, to: target }); res.moved++; }
        }
      }
    } catch (e: any) {
      if (e instanceof AiError && e.limit) { res.limited = e.limit.scope; break; }
      if (e instanceof AiError && !e.retryable) break;
      await db.updatePost(post.id, { misc_checked_at: Date.now() }, undefined, { boardId: post.boardId, ready: true });
    }
    res.checked++;
    report();
    if (res.checked < batch.length) await new Promise(resolve => setTimeout(resolve, 1200));
  }
  res.left = posts.length - res.checked;
  backfillEmbeddings().catch(() => {});
  return res;
}
