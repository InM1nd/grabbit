// Board choice: strict id from the AI answer, a confident new board, or an embedding-based fallback.
import { DEFAULT_BOARDS, defaultBoardKey, findBoardByName, type BoardLang, type BoardNames } from './boards';
import { cosine, normalize } from './embed';

export interface AiBoard extends BoardNames {
  id: number; tags?: string[]; count?: number;
  /** Titles of a few recent posts on the board: they tell the model what a custom-named board is really about. */
  samples?: string[];
}

/**
 * New boards are created only when the model is at least this sure of the topic (1.10.1: 0.7 → 0.6).
 * The prompt now defines confidence as "how clear the topic is", so a clear topic with no matching board
 * is a good reason to create one instead of dropping the post in Misc.
 */
export const NEW_BOARD_MIN_CONFIDENCE = 0.6;
/** Below this the AI choice is treated as a guess and the embedding fallback may override Misc. */
export const LOW_CONFIDENCE = 0.5;

export type BoardChoice =
  | { kind: 'existing'; id: number; confidence: number }
  | { kind: 'new'; names: { ru: string; en: string; uk: string }; emoji?: string; confidence: number; /** some names missing/invalid → translate later */ partial?: boolean }
  | { kind: 'misc'; confidence: number; reason: 'ai' | 'forced' | 'unsure' };

export interface RawBoardAnswer {
  boardId?: unknown; board?: unknown; boardEmoji?: unknown; confidence?: unknown;
  newBoard?: { ru?: unknown; en?: unknown; uk?: unknown } | null;
}

/**
 * A board name the model gave for one language, or '' if it's unusable. Cuts at the first character
 * outside Latin/Cyrillic (the model sometimes glues junk like "арт唱EN:"), rejects Cyrillic in the
 * English name and Latin-only multi-word names for RU/UK.
 */
export function cleanBoardName(v: unknown, lang: BoardLang): string {
  let s = str(v);
  const m = s.match(/^[\p{Script=Latin}\p{Script=Cyrillic}\p{N} &'’\-/+.,]+/u);
  s = (m ? m[0] : '').replace(/\s+[A-Z]{2}:?$|[\s,.\-/]+$/u, '').trim();
  if (!s) return '';
  const cyr = /\p{Script=Cyrillic}/u.test(s);
  if (lang === 'en' && cyr) return '';
  if (lang !== 'en' && !cyr && /\s/.test(s)) return '';
  return s;
}

const str = (v: unknown, max = 40) => (typeof v === 'string' ? v.trim().replace(/^["«]|["»]$/g, '').trim().slice(0, max) : '');
export function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0.6; // older models / missing field: neutral
  return Math.min(1, Math.max(0, n > 1 && n <= 100 ? n / 100 : n));
}

/**
 * Turn the model's answer into a board decision.
 * Order: valid boardId → newBoard (only with confidence ≥ 0.7, reusing a same-named board) → name match → Misc.
 */
export function resolveBoard(a: RawBoardAnswer, boards: AiBoard[], lang: BoardLang): BoardChoice {
  const confidence = clampConfidence(a.confidence);

  const idRaw = typeof a.boardId === 'number' ? String(a.boardId) : str(a.boardId, 12).replace(/^#|^id\s*=?\s*/i, '');
  if (/^(?:misc|none|other|разное|0)$/i.test(idRaw)) return { kind: 'misc', confidence, reason: 'ai' };
  if (/^\d+$/.test(idRaw)) {
    const hit = boards.find((b) => b.id === Number(idRaw));
    if (hit) return hit.key === 'misc' ? { kind: 'misc', confidence, reason: 'ai' } : { kind: 'existing', id: hit.id, confidence };
  }
  const nb = a.newBoard && typeof a.newBoard === 'object' ? a.newBoard : null;
  const names = nb ? { ru: cleanBoardName(nb.ru, 'ru'), en: cleanBoardName(nb.en, 'en'), uk: cleanBoardName(nb.uk, 'uk') } : null;
  if (names && (names.ru || names.en || names.uk)) {
    const any = names[lang] || names.en || names.ru || names.uk;
    const full = { ru: names.ru || any, en: names.en || any, uk: names.uk || any };
    // The "new" board may already exist under one of its names (or be a default board).
    for (const n of [full.ru, full.en, full.uk]) {
      const ex = findBoardByName(n, boards);
      if (ex) return ex.key === 'misc' ? { kind: 'misc', confidence, reason: 'ai' } : { kind: 'existing', id: ex.id, confidence };
    }
    const dk = defaultBoardKey(any);
    if (dk === 'misc') return { kind: 'misc', confidence, reason: 'ai' };
    if (confidence >= NEW_BOARD_MIN_CONFIDENCE) {
      const d = dk ? DEFAULT_BOARDS[dk] : null;
      return { kind: 'new', names: d ? { ru: d.ru, en: d.en, uk: d.uk } : full, emoji: str(a.boardEmoji, 4) || d?.emoji || undefined, confidence, partial: !d && !(names.ru && names.en && names.uk) };
    }
    return { kind: 'misc', confidence, reason: 'unsure' };
  }
  const byName = str(a.board) ? findBoardByName(str(a.board), boards) : undefined;
  if (byName) return byName.key === 'misc' ? { kind: 'misc', confidence, reason: 'ai' } : { kind: 'existing', id: byName.id, confidence };
  // Free-text name of a board that doesn't exist (old-style answer): create it only when sure.
  const free = str(a.board);
  if (free && defaultBoardKey(free) !== 'misc' && confidence >= NEW_BOARD_MIN_CONFIDENCE) {
    const dk = defaultBoardKey(free);
    const d = dk ? DEFAULT_BOARDS[dk] : null;
    return { kind: 'new', names: d ? { ru: d.ru, en: d.en, uk: d.uk } : { ru: free, en: free, uk: free }, emoji: str(a.boardEmoji, 4) || d?.emoji, confidence, partial: !d };
  }
  return { kind: 'misc', confidence, reason: free ? 'unsure' : 'ai' };
}

/** Text that describes a board for its "name embedding" (used while it has few posts). */
export function boardEmbedText(b: AiBoard): string {
  const d = b.key ? DEFAULT_BOARDS[b.key] : undefined;
  const names = [...new Set([b.name, b.nameEn, b.nameRu, b.nameUk, d?.en, d?.ru].filter(Boolean))];
  return [`Board: ${names.join(' / ')}`, b.tags?.length ? b.tags.map((x) => '#' + x).join(' ') : ''].filter(Boolean).join('\n');
}

/** Mean of normalized vectors, renormalized. */
export function centroid(vecs: number[][]): number[] | null {
  const vs = vecs.filter((v) => v?.length);
  if (!vs.length) return null;
  const out = new Array(vs[0].length).fill(0);
  for (const v of vs) { if (v.length !== out.length) continue; const nv = normalize(v); for (let i = 0; i < out.length; i++) out[i] += nv[i]; }
  return normalize(out);
}

export interface BoardVector { id: number; vec: number[]; kind: 'centroid' | 'name' }

export interface PickOpts {
  centroidFloor: number; nameFloor: number; nameOffset: number; margin: number; nameMargin: number; minPosts: number;
}

/**
 * Raw gemini-embedding-001 cosines are very compressed: on a live RU/EN sample (2026-10-30) a post scored
 * 0.83–0.93 against *every* topic centroid; the right board led by 0.03–0.07, unrelated posts led by
 * < 0.005. So the decision is relative: the best board must beat the runner-up by a clear margin.
 * Name embeddings ("Board: Recipes / Рецепты") score ~0.04 lower and are noisier → offset + bigger margin.
 * Used only when there are too few boards to estimate a common component (see MIN_CANDIDATES_FOR_CENTERING).
 */
export const EMBED_PICK: PickOpts = { centroidFloor: 0.75, nameFloor: 0.7, nameOffset: 0.04, margin: 0.02, nameMargin: 0.03, minPosts: 3 };

/**
 * 1.10.1: the same decision after subtracting the mean board vector (the component all vectors share, which
 * is what squeezes raw cosines into 0.83–0.93). Scores then span roughly −0.3…0.6, so the same noise matters
 * far less and the margin can be a real gap instead of 0.02. NOT tuned on live data yet — starting values from
 * the simulation in tests/sorting.test.ts; re-tune with scripts/embed-calibrate.mts.
 */
export const EMBED_PICK_CENTERED: PickOpts = { centroidFloor: 0.25, nameFloor: 0.22, nameOffset: 0.05, margin: 0.06, nameMargin: 0.07, minPosts: 3 };

/** With fewer boards than this the "mean board" is just one of them and centering would destroy the signal. */
export const MIN_CANDIDATES_FOR_CENTERING = 4;
/** Posts needed before a board is represented by its centroid instead of its name (shared with processor.ts). */
export const MIN_CENTROID_POSTS = EMBED_PICK.minPosts;

/** Subtract `mean` and renormalize. */
export function centerVec(v: number[], mean: number[]): number[] {
  if (v.length !== mean.length) return v;
  return normalize(v.map((x, i) => x - mean[i]));
}

export interface PreparedBoards { cands: BoardVector[]; centered: boolean; mean: number[] | null }

/** Center the candidates once; reuse for many posts («Разобрать» checks up to hundreds of them). */
export function prepareBoardVectors(cands: BoardVector[]): PreparedBoards {
  const ok = cands.filter((c) => c.vec?.length);
  const dim = ok[0]?.vec.length ?? 0;
  const same = ok.filter((c) => c.vec.length === dim);
  if (same.length < MIN_CANDIDATES_FOR_CENTERING) return { cands: same, centered: false, mean: null };
  const mean = new Array(dim).fill(0);
  for (const c of same) { const n = normalize(c.vec); for (let i = 0; i < dim; i++) mean[i] += n[i] / same.length; }
  return { cands: same.map((c) => ({ ...c, vec: centerVec(normalize(c.vec), mean) })), centered: true, mean };
}

/** Best board by embedding similarity, or null if nothing clearly stands out. */
export function pickBoard(vec: number[] | null | undefined, prep: PreparedBoards, opts?: PickOpts): { id: number; score: number } | null {
  if (!vec?.length || !prep.cands.length) return null;
  const o = opts ?? (prep.centered ? EMBED_PICK_CENTERED : EMBED_PICK);
  const q = prep.centered && prep.mean ? centerVec(normalize(vec), prep.mean) : vec;
  const scored = prep.cands.map((c) => {
    const raw = cosine(q, c.vec);
    return { id: c.id, kind: c.kind, raw, adj: c.kind === 'name' ? raw + o.nameOffset : raw };
  }).sort((a, b) => b.adj - a.adj);
  const [best] = scored;
  const second = scored.find((x) => x.id !== best.id);
  if (best.raw < (best.kind === 'name' ? o.nameFloor : o.centroidFloor)) return null;
  const need = best.kind === 'name' || second?.kind === 'name' ? o.nameMargin : o.margin;
  if (second && best.adj - second.adj < need) return null;
  return { id: best.id, score: best.raw };
}

export function pickBoardByEmbedding(vec: number[] | null | undefined, cands: BoardVector[], opts?: PickOpts): { id: number; score: number } | null {
  return pickBoard(vec, prepareBoardVectors(cands), opts);
}

/** Prompt + parser for the one-off translation of the user's AI-created boards. */
export function buildTranslatePrompt(boards: { id: number; name: string }[]): string {
  return [
    'Переведи названия досок органайзера постов. Для каждой доски дай короткое естественное название (1–3 слова) на русском (ru), английском (en) и украинском (uk).',
    'Имена собственные и названия продуктов (например "Figma", "ChatGPT") не переводи. Смысл не меняй.',
    'Верни их в поле boardNames: [{id, ru, en, uk}] с теми же id. В остальные обязательные поля напиши: title "boards", summary "translated board names", tags [], board "-".',
    '',
    ...boards.map((b) => `id=${b.id}: "${b.name.replace(/"/g, "'").slice(0, 40)}"`),
  ].join('\n');
}

export function parseTranslations(parsed: any, ids: number[]): Map<number, { ru: string; en: string; uk: string }> {
  const out = new Map<number, { ru: string; en: string; uk: string }>();
  const list = Array.isArray(parsed?.boardNames) ? parsed.boardNames : [];
  for (const x of list) {
    const id = Number(x?.id);
    if (!ids.includes(id)) continue;
    const en = cleanBoardName(x.en, 'en');
    // a Latin name left untranslated (brand / "Smart home") is still fine
    const same = (v: unknown) => (en && cleanBoardName(v, 'en') === en ? en : '');
    const ru = cleanBoardName(x.ru, 'ru') || same(x.ru), uk = cleanBoardName(x.uk, 'uk') || same(x.uk);
    if (ru && en && uk) out.set(id, { ru, en, uk });
  }
  return out;
}
