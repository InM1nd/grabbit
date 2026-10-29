// Semantic search / similar posts: Gemini text embeddings + cosine similarity.
// gemini-embedding-001 verified live 2026-10-28 (batchEmbedContents, taskType, outputDimensionality).

export const EMBED_MODEL = 'gemini-embedding-001';
export const EMBED_DIM = 256;
import { canUseGemini, geminiTarget, type GeminiAuth } from './gemini';

export type TaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY';

export interface EmbeddableFields {
  aiTitle?: string | null; title?: string | null; summary?: string | null; tags?: string[];
  note?: string | null; description?: string | null; author?: string | null; board?: string | null;
}

/** Text that represents a post for embedding. Empty string = nothing worth embedding yet. */
export function embedText(p: EmbeddableFields): string {
  const parts = [
    p.aiTitle || p.title,
    p.summary,
    p.note,
    p.tags?.length ? p.tags.map((x) => '#' + x).join(' ') : '',
    p.board,
    p.description ? p.description.slice(0, 600) : '',
    p.author,
  ].map((s) => (s || '').trim()).filter(Boolean);
  return parts.join('\n').slice(0, 2000);
}

export function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/** Cosine of two vectors (works for unnormalized input too). */
export function cosine(a: number[], b: number[]): number {
  if (!a?.length || a.length !== b?.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

/** Compact storage: 4 decimals is plenty for cosine ranking. */
export const packVec = (v: number[]) => JSON.stringify(v.map((x) => Math.round(x * 1e4) / 1e4));
export function unpackVec(s: string | null | undefined): number[] | null {
  if (!s) return null;
  try { const v = JSON.parse(s); return Array.isArray(v) && v.length ? v : null; } catch { return null; }
}

export class EmbedError extends Error {
  constructor(msg: string, public status?: number) { super(msg); }
}

/** Embed up to 100 texts in one request. Returns normalized vectors in input order. */
export async function embedTexts(texts: string[], auth: GeminiAuth, task: TaskType, timeoutMs = 12000): Promise<number[][]> {
  if (!texts.length) return [];
  const tg = geminiTarget(auth, `models/${EMBED_MODEL}:batchEmbedContents`);
  if (!canUseGemini(auth) || !tg) throw new EmbedError('no key');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(tg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tg.headers },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${EMBED_MODEL}`, content: { parts: [{ text }] }, taskType: task, outputDimensionality: EMBED_DIM,
        })),
      }),
      signal: ctrl.signal,
    });
    const txt = await r.text();
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { msg = JSON.parse(txt).error?.message?.slice(0, 160) || msg; } catch {}
      throw new EmbedError(msg, r.status);
    }
    const j = JSON.parse(txt);
    const out = (j.embeddings || []).map((e: any) => normalize(e.values || []));
    if (out.length !== texts.length || out.some((v: number[]) => v.length !== EMBED_DIM)) throw new EmbedError('bad embedding response');
    return out;
  } catch (e: any) {
    if (e instanceof EmbedError) throw e;
    throw new EmbedError(e?.name === 'AbortError' ? 'timeout' : String(e?.message || e));
  } finally {
    clearTimeout(timer);
  }
}

export interface Rankable { id: number; embedding?: number[] | null; tags: string[] }

/**
 * Gemini embedding cosines are compressed (unrelated ≈0.6, related ≈0.75–0.9), so a fixed cutoff
 * doesn't work. Keep scores that stand out from this collection: ≥ mean + k·sd and within `gap` of the best.
 * Tuned live 2026-10-28 on a RU/EN sample (scripts in tests/embed.test.ts docs).
 */
export function adaptiveCut(scores: number[], k: number, gap: number, floor: number): number {
  if (!scores.length) return Infinity;
  const top = Math.max(...scores);
  if (scores.length < 4) return Math.max(floor, top - gap);
  const m = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - m) ** 2, 0) / scores.length);
  return Math.max(floor, m + k * sd, top - gap);
}

/** Posts ranked by similarity to a query vector, best first, keeping only clear matches. */
export function rankByVector<T extends Rankable>(q: number[], posts: T[], opts: { k?: number; gap?: number; floor?: number; limit?: number } = {}): { post: T; score: number }[] {
  const { k = 0.7, gap = 0.1, floor = 0.55, limit = 200 } = opts;
  const scored = posts.filter((p) => p.embedding?.length).map((post) => ({ post, score: cosine(q, post.embedding!) }));
  const cut = adaptiveCut(scored.map((x) => x.score), k, gap, floor);
  return scored.filter((x) => x.score >= cut).sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Similar posts for the detail view: embedding cosine when both sides have one,
 * otherwise (or to fill up) posts sharing tags / board.
 */
export function similarPosts<T extends Rankable & { boardId?: number | null }>(target: T, all: T[], limit = 6): T[] {
  const others = all.filter((p) => p.id !== target.id);
  const out: T[] = [];
  if (target.embedding?.length) {
    for (const { post } of rankByVector(target.embedding, others, { k: 1, gap: 0.08, floor: 0.6, limit })) out.push(post);
  }
  if (out.length < limit && target.tags.length) {
    const tset = new Set(target.tags);
    const byTags = others
      .filter((p) => !out.includes(p))
      .map((p) => ({ p, n: p.tags.filter((x) => tset.has(x)).length + (target.boardId != null && p.boardId === target.boardId ? 0.5 : 0) }))
      .filter((x) => x.n >= 1)
      .sort((a, b) => b.n - a.n);
    for (const { p } of byTags) { if (out.length >= limit) break; out.push(p); }
  }
  return out;
}
