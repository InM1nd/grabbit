import { DEFAULT_BOARDS, miscName, type BoardLang } from './boards';
import { buildTranslatePrompt, parseTranslations, resolveBoard, type AiBoard, type BoardChoice } from './sorting';
import type { AiResult, Metadata } from './types';
import { PLATFORM_LABEL } from './url';
import { canUseGemini, geminiTarget, proxyLimitInfo, type GeminiAuth } from './gemini';

// 3.5-flash: good quality + reliable on the free tier; the -latest aliases are fallbacks (3.8-flash often 503s under load).
// Order = preference. Benchmarked 2026-10-28 (scripts/ai-bench.mts): gemini-flash-latest timed out 8/10 at 20 s,
// gemini-3.5-flash hits free-tier 429/503 after a few calls a minute, the flash-lite models answer reliably.
export const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite'];

/** model -> epoch ms until which it is skipped (429 quota / 404 gone). */
const cooldown = new Map<string, number>();
let available: Set<string> | null = null;
let availableAt = 0;

/** Drop models the key can't use (deprecated/renamed). Cached for 6 h; failures are ignored. */
async function refreshAvailable(auth: GeminiAuth) {
  if (Date.now() - availableAt < 6 * 3600_000) return;
  availableAt = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const tg = geminiTarget(auth, 'models?pageSize=200');
    if (!tg) return;
    const r = await fetch(tg.url, { headers: tg.headers, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return;
    const j = await r.json();
    const names = new Set<string>((j.models || []).map((m: any) => String(m.name).replace(/^models\//, '')));
    if (GEMINI_MODELS.some((m) => names.has(m))) available = names;
  } catch {}
}

function retryDelayMs(txt: string): number {
  const m = txt.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.min(Math.max(Number(m[1]) * 1000, 5000), 10 * 60_000) : 60_000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** @internal for tests/benchmarks */
export function _resetAiState() { cooldown.clear(); available = null; availableAt = 0; }

export class AiError extends Error {
  constructor(message: string, public retryable: boolean, public status?: number, public limit?: { scope: 'device' | 'global'; retryAfterSec: number }) { super(message); }
}

export interface AiInput {
  meta: Metadata;
  sharedText?: string;
  /** Existing boards (id + display name + frequent tags). Plain names are accepted for old callers/tests. */
  boards: (AiBoard | string)[];
  /** Preview image (base64) — sent when the caption is weak so Gemini can "look" at the post. */
  image?: { mimeType: string; data: string };
  /** Free-text note the user typed about the post. */
  note?: string;
  /** Language of title/summary/tags: Russian (default), English, or the post's own language. */
  lang?: 'ru' | 'en' | 'orig';
  /** UI language: names of new boards are written in it. */
  boardLang?: BoardLang;
}

const BOARD_LANG_PHRASE = { ru: 'на русском', en: 'на английском (in English)', uk: 'на украинском (українською)' } as const;
const LANG_PHRASE = { ru: 'на русском', en: 'на английском (in English)', orig: 'на языке оригинала поста' } as const;

/** Guess image mime type from base64 magic bytes. */
export function sniffMime(b64: string): string {
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('UklGR')) return 'image/webp';
  if (b64.startsWith('R0lG')) return 'image/gif';
  return 'image/jpeg';
}

/** Caption too thin to understand the post (emoji, hashtags only, "Instagram reel" etc.). */
export function isWeakText(meta: Metadata, sharedText?: string, note?: string): boolean {
  const txt = [meta.description, sharedText, note].filter(Boolean).join(' ')
    .replace(/#[\p{L}\p{N}_]+/gu, '').replace(/@[\w.]+/g, '').replace(/https?:\/\/\S+/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  return txt.split(' ').filter((w) => w.length > 2).length < 8;
}

/** Must stay identical to server/lib/validate.ts RESPONSE_SCHEMA (the proxy enforces its own copy). */
export const SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Короткий заголовок, до 60 символов' },
    summary: { type: 'STRING', description: '1–3 предложения: о чём пост и чем полезен' },
    tags: { type: 'ARRAY', items: { type: 'STRING' }, description: '3–6 тегов, строчными буквами' },
    board: { type: 'STRING', description: 'Название выбранной доски' },
    boardEmoji: { type: 'STRING', description: 'Один эмодзи для доски' },
    boardId: { type: 'STRING', description: 'id существующей доски из списка, или "new"' },
    confidence: { type: 'NUMBER', description: 'Уверенность в выборе доски, 0..1' },
    newBoard: { type: 'OBJECT', properties: { ru: { type: 'STRING' }, en: { type: 'STRING' }, uk: { type: 'STRING' } }, required: ['ru', 'en', 'uk'] },
    boardNames: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'INTEGER' }, ru: { type: 'STRING' }, en: { type: 'STRING' }, uk: { type: 'STRING' } }, required: ['id', 'ru', 'en', 'uk'] } },
  },
  required: ['title', 'summary', 'tags', 'board'],
};

const asBoards = (list: (AiBoard | string)[]): AiBoard[] => list.map((b, i) => (typeof b === 'string' ? { id: i + 1, name: b } : b));
/** Board list for the prompt; tags are trimmed so the whole prompt stays under the proxy's 12k chars. */
export function boardLines(boards: AiBoard[], budget = 4500): string[] {
  for (const n of [5, 3, 0]) {
    const lines = boards.slice(0, 80).map((b) => `- id=${b.id}: ${q(b.name)}${n && b.tags?.length ? ` — теги: ${b.tags.slice(0, n).map((t) => t.slice(0, 20)).join(', ')}` : ''}`);
    if (lines.join('\n').length <= budget || n === 0) return lines;
  }
  return [];
}
const q = (s: string) => `"${s.replace(/"/g, "'").slice(0, 40)}"`;

export function buildPrompt({ meta, sharedText, boards: rawBoards, image, note, lang = 'ru', boardLang = 'ru' }: AiInput): string {
  const L = LANG_PHRASE[lang];
  const BL = BOARD_LANG_PHRASE[boardLang];
  const boards = asBoards(rawBoards);
  const examples = Object.entries(DEFAULT_BOARDS).filter(([k]) => k !== 'misc').map(([, v]) => `"${v[boardLang]}"`).join(', ');
  const misc = boards.find((b) => b.key === 'misc');
  const miscLabel = misc ? `id=${misc.id} (${q(miscName(boardLang))})` : q(miscName(boardLang));
  const lines = [
    'Ты помогаешь вести личный органайзер сохранённых постов из соцсетей (как Pinterest).',
    'Пользователь в основном сохраняет посты про технологии: ИИ-инструменты, программирование, гаджеты, дизайн, стартапы, но может быть что угодно.',
    'По данным ниже:',
    `1) title — короткий понятный заголовок ${L} (до 60 символов), без кликбейта;`,
    `2) summary — 1–3 предложения ${L}: о чём пост и что из него можно взять. Если данных мало, честно опиши, что известно (платформа, автор), не выдумывай детали;`,
    `3) tags — 3–6 коротких тегов строчными буквами ${L} (названия продуктов/технологий можно латиницей, например "chatgpt", "react");`,
    '4) доска. Сначала пойми тему поста (по тексту, картинке, тегам, автору), потом сравни её с досками из списка (у каждой указаны частые теги).',
    '   • Если тема подходит к существующей доске хотя бы в целом — верни её id в boardId (только число из списка) и её название в board. Предпочитай существующие доски.',
    `   • Если ни одна не подходит, а тема ясна — boardId "new", newBoard {ru, en, uk}: широкая тема в 1–3 слова на всех трёх языках (например ${examples}), не узкая под один пост; board — название ${BL}.`,
    `   • Доска ${miscLabel} — только когда тему поста действительно невозможно понять. Если тема понятна, не выбирай её.`,
    '   • confidence — насколько ты уверен в выборе доски, от 0 до 1.',
    '5) boardEmoji — один эмодзи для доски.',
    '',
    'Существующие доски:',
    ...(boards.length ? boardLines(boards) : ['(пока нет)']),
    '',
    `Платформа: ${PLATFORM_LABEL[meta.platform]}`,
    `Ссылка: ${meta.url}`,
  ];
  if (meta.author) lines.push(`Автор: ${meta.author}`);
  if (meta.title) lines.push(`Заголовок: ${meta.title}`);
  if (meta.description) lines.push(`Текст/описание: ${meta.description.slice(0, 3000)}`);
  if (sharedText) lines.push(`Текст, который пришёл вместе со ссылкой: ${sharedText.slice(0, 1500)}`);
  if (note) lines.push(`Заметка пользователя о посте (главный источник): ${note.slice(0, 1000)}`);
  if (image) lines.push('Приложено превью поста (кадр/обложка). Внимательно рассмотри его: текст на картинке, интерфейсы, предметы, людей — и опиши, о чём пост, по тому, что видно. Не выдумывай то, чего не видно.');
  if (meta.unavailable && !note && !image) lines.push('(Платформа сообщает, что пост недоступен без входа: приватный аккаунт, ограничение по возрасту или пост удалён. Честно напиши это в summary и предложи подключить Instagram в настройках или добавить заметку.)');
  else if (meta.blocked && !sharedText && !note && !image) lines.push('(Сайт не отдал метаданные — опирайся на ссылку и платформу.)');
  return lines.join('\n');
}

/** Opaque links (IG/TikTok/X ids) with no metadata: the model can only guess, so they go to Misc for now. */
export function isOpaque(input: Pick<AiInput, 'meta' | 'sharedText' | 'note' | 'image'>): boolean {
  return !!input.meta.blocked && !input.sharedText && !input.note && !input.image && ['instagram', 'tiktok', 'x', 'threads', 'facebook'].includes(input.meta.platform);
}

/**
 * Robust Gemini call: walks the model chain, skips models on quota cooldown / unavailable,
 * treats empty or unparseable answers as a failure of that model, and makes a second pass
 * over transiently failing models (503 / timeout / bad JSON) before giving up.
 * `timeoutMs` is per request; `budgetMs` caps the whole call.
 */
export async function analyzePost(input: AiInput, auth: GeminiAuth, timeoutMs = 12000, budgetMs = 45000): Promise<AiResult> {
  const boards = asBoards(input.boards);
  const lang = input.boardLang ?? 'ru';
  return generateJson(buildPrompt(input), input.image, auth, timeoutMs, budgetMs, (parsed, model) => {
    const summary = String(parsed?.summary || '').trim();
    if (summary.length < 10) return null;
    const tags: string[] = Array.isArray(parsed.tags)
      ? [...new Set<string>(parsed.tags.map((t: any) => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean))].slice(0, 6)
      : [];
    const choice: BoardChoice = isOpaque(input)
      ? { kind: 'misc', confidence: 0, reason: 'forced' }
      : resolveBoard(parsed, boards, lang);
    const hit = choice.kind === 'existing' ? boards.find((b) => b.id === choice.id) : undefined;
    const board = choice.kind === 'existing' ? hit!.name : choice.kind === 'new' ? choice.names[lang] : (boards.find((b) => b.key === 'misc')?.name ?? miscName(lang));
    return {
      title: parsed.title ? String(parsed.title).trim().slice(0, 90) : undefined,
      summary,
      tags,
      board,
      choice,
      boardEmoji: choice.kind === 'misc' ? '🗂️' : parsed.boardEmoji ? String(parsed.boardEmoji).trim().slice(0, 4) : undefined,
      model,
    };
  });
}

/**
 * One-off: translate the names of the user's own boards (created before 1.10.0) into RU/EN/UK.
 * Uses one analysis request for up to 40 boards.
 */
export async function translateBoardNames(boards: { id: number; name: string }[], auth: GeminiAuth): Promise<Map<number, { ru: string; en: string; uk: string }>> {
  const ids = boards.map((b) => b.id);
  return generateJson(buildTranslatePrompt(boards), undefined, auth, 15000, 40000, (parsed) => {
    const m = parseTranslations(parsed, ids);
    return m.size ? m : null;
  });
}

async function generateJson<T>(prompt: string, image: AiInput['image'], auth: GeminiAuth, timeoutMs: number, budgetMs: number, accept: (parsed: any, model: string) => T | null): Promise<T> {
  if (!canUseGemini(auth)) throw new AiError('Нет ключа Gemini', false);
  const started = Date.now();
  const input = { image };
  const bodyFor = (model: string) => JSON.stringify({
    contents: [{ role: 'user', parts: [
      { text: prompt },
      ...(input.image ? [{ inlineData: { mimeType: input.image.mimeType, data: input.image.data } }] : []),
    ] }],
    generationConfig: {
      responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.4,
      // Thinking tokens count against the output budget — keep thinking minimal and leave ample room.
      maxOutputTokens: 4096,
      ...(model.includes('lite') ? {} : { thinkingConfig: { thinkingLevel: 'low' } }),
    },
  });
  await refreshAvailable(auth);
  let lastErr: AiError = new AiError('Gemini недоступен', true);
  let anyAttempt = false;
  const transient: string[] = [];

  const tryModel = async (model: string): Promise<T | null> => {
    const left = budgetMs - (Date.now() - started);
    if (left < 2000) return null;
    anyAttempt = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, left));
    try {
      const tg = geminiTarget(auth, `models/${model}:generateContent`)!;
      const r = await fetch(tg.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tg.headers },
        body: bodyFor(model),
        signal: ctrl.signal,
      });
      const txt = await r.text();
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try { msg = JSON.parse(txt).error?.message?.slice(0, 200) || msg; } catch {}
        const lim = proxyLimitInfo(r.status, txt);
        if (lim) throw new AiError(msg, true, 429, lim); // our daily limit: other models won't help
        if (r.status === 429) cooldown.set(model, Date.now() + retryDelayMs(txt));
        else if (r.status === 404) cooldown.set(model, Date.now() + 24 * 3600_000);
        else if (r.status >= 500) transient.push(model);
        // 429 quota / 5xx overload / 404 gone: next model, retry later. 400/403 = bad key/request.
        lastErr = new AiError(msg, r.status === 429 || r.status >= 500 || r.status === 404, r.status);
        return null;
      }
      const j = JSON.parse(txt);
      const cand = j.candidates?.[0];
      const out = cand?.content?.parts?.filter((p: any) => !p.thought).map((p: any) => p.text || '').join('') || '';
      let parsed: any;
      try {
        parsed = JSON.parse(out.replace(/^\s*```(?:json)?|```\s*$/g, '').trim());
      } catch {
        transient.push(model);
        lastErr = new AiError(`Gemini: неполный ответ (${cand?.finishReason || 'пусто'})`, true);
        return null;
      }
      const res = parsed && typeof parsed === 'object' ? accept(parsed, j.modelVersion || model) : null;
      if (!res) {
        transient.push(model);
        lastErr = new AiError('Gemini: пустой ответ', true);
        return null;
      }
      return res;
    } catch (e: any) {
      if (e instanceof AiError && e.limit) throw e;
      // network error / timeout → retry later
      transient.push(model);
      lastErr = e instanceof AiError ? e : new AiError(e?.name === 'AbortError' ? 'Таймаут Gemini' : String(e?.message || e), true);
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const usable = (m: string) => (!available || available.has(m)) && (cooldown.get(m) ?? 0) <= Date.now();
  for (const model of GEMINI_MODELS.filter(usable)) {
    const res = await tryModel(model);
    if (res) return res;
  }
  // Second pass: overloaded / timed-out / garbled models often succeed a moment later.
  const again = [...new Set(transient)].filter(usable);
  if (again.length) {
    await sleep(1500);
    for (const model of again) {
      const res = await tryModel(model);
      if (res) return res;
    }
  }
  if (!anyAttempt) {
    // Everything on cooldown: try the model whose cooldown ends first rather than failing outright.
    const soonest = [...GEMINI_MODELS].sort((a, b) => (cooldown.get(a) ?? 0) - (cooldown.get(b) ?? 0))[0];
    const res = await tryModel(soonest);
    if (res) return res;
  }
  throw lastErr;
}

