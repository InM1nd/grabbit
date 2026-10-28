import type { AiResult, Metadata } from './types';
import { PLATFORM_LABEL } from './url';

// 3.5-flash: good quality + reliable on the free tier; the -latest aliases are fallbacks (3.8-flash often 503s under load).
// Order = preference. Benchmarked 2026-10-28 (scripts/ai-bench.mts): gemini-flash-latest timed out 8/10 at 20 s,
// gemini-3.5-flash hits free-tier 429/503 after a few calls a minute, the flash-lite models answer reliably.
export const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite'];
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** model -> epoch ms until which it is skipped (429 quota / 404 gone). */
const cooldown = new Map<string, number>();
let available: Set<string> | null = null;
let availableAt = 0;

/** Drop models the key can't use (deprecated/renamed). Cached for 6 h; failures are ignored. */
async function refreshAvailable(apiKey: string) {
  if (Date.now() - availableAt < 6 * 3600_000) return;
  availableAt = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${ENDPOINT}?pageSize=200`, { headers: { 'x-goog-api-key': apiKey }, signal: ctrl.signal });
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
  constructor(message: string, public retryable: boolean, public status?: number) { super(message); }
}

export interface AiInput {
  meta: Metadata;
  sharedText?: string;
  boards: string[]; // existing board names
  /** Preview image (base64) — sent when the caption is weak so Gemini can "look" at the post. */
  image?: { mimeType: string; data: string };
  /** Free-text note the user typed about the post. */
  note?: string;
  /** Language of title/summary/tags: Russian (default), English, or the post's own language. Boards stay Russian. */
  lang?: 'ru' | 'en' | 'orig';
}

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

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Короткий заголовок, до 60 символов' },
    summary: { type: 'STRING', description: '1–3 предложения: о чём пост и чем полезен' },
    tags: { type: 'ARRAY', items: { type: 'STRING' }, description: '3–6 тегов, строчными буквами' },
    board: { type: 'STRING', description: 'Название доски' },
    boardEmoji: { type: 'STRING', description: 'Один эмодзи для доски' },
  },
  required: ['title', 'summary', 'tags', 'board'],
};

export function buildPrompt({ meta, sharedText, boards, image, note, lang = 'ru' }: AiInput): string {
  const L = LANG_PHRASE[lang];
  const lines = [
    'Ты помогаешь вести личный органайзер сохранённых постов из соцсетей (как Pinterest).',
    'Пользователь в основном сохраняет посты про технологии: ИИ-инструменты, программирование, гаджеты, дизайн, стартапы, но может быть что угодно.',
    'По данным ниже:',
    `1) title — короткий понятный заголовок ${L} (до 60 символов), без кликбейта;`,
    `2) summary — 1–3 предложения ${L}: о чём пост и что из него можно взять. Если данных мало, честно опиши, что известно (платформа, автор), не выдумывай детали;`,
    `3) tags — 3–6 коротких тегов строчными буквами ${L} (названия продуктов/технологий можно латиницей, например "chatgpt", "react");`,
    '4) board — тематическая доска. ОБЯЗАТЕЛЬНО выбери одну из существующих досок, если пост к ней подходит по смыслу (верни её название точно как в списке). Новую доску создавай только если ни одна не подходит: 1–3 слова на русском, широкая тема (например "ИИ-инструменты", "Программирование", "Гаджеты", "Дизайн и UI", "Продуктивность"), а не узкая под один пост;',
    '   Не притягивай пост к существующей доске по формальному признаку (платформа, «интернет») — доска должна отражать тему содержания. Если о содержании почти ничего не известно, выбери доску "Разное".',
    '5) boardEmoji — один эмодзи для доски.',
    '',
    `Существующие доски: ${boards.length ? boards.map((b) => `"${b}"`).join(', ') : '(пока нет)'}`,
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

function matchBoard(name: string, boards: string[]): string {
  const n = name.trim().replace(/^["«]|["»]$/g, '');
  const low = n.toLowerCase();
  return boards.find((b) => b.toLowerCase() === low) ?? n;
}

/**
 * Robust Gemini call: walks the model chain, skips models on quota cooldown / unavailable,
 * treats empty or unparseable answers as a failure of that model, and makes a second pass
 * over transiently failing models (503 / timeout / bad JSON) before giving up.
 * `timeoutMs` is per request; `budgetMs` caps the whole call.
 */
export async function analyzePost(input: AiInput, apiKey: string, timeoutMs = 15000, budgetMs = 45000): Promise<AiResult> {
  if (!apiKey) throw new AiError('Нет ключа Gemini', false);
  const started = Date.now();
  const prompt = buildPrompt(input);
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
  await refreshAvailable(apiKey);
  let lastErr: AiError = new AiError('Gemini недоступен', true);
  let anyAttempt = false;
  const transient: string[] = [];

  const tryModel = async (model: string): Promise<AiResult | null> => {
    const left = budgetMs - (Date.now() - started);
    if (left < 2000) return null;
    anyAttempt = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(timeoutMs, left));
    try {
      const r = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: bodyFor(model),
        signal: ctrl.signal,
      });
      const txt = await r.text();
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try { msg = JSON.parse(txt).error?.message?.slice(0, 200) || msg; } catch {}
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
      const summary = String(parsed?.summary || '').trim();
      if (!parsed || typeof parsed !== 'object' || summary.length < 10) {
        transient.push(model);
        lastErr = new AiError('Gemini: пустой ответ', true);
        return null;
      }
      const tags: string[] = Array.isArray(parsed.tags)
        ? [...new Set<string>(parsed.tags.map((t: any) => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean))].slice(0, 6)
        : [];
      // Opaque links (IG/TikTok/X ids) with no metadata: don't let the model guess a topic board.
      const opaque = input.meta.blocked && !input.sharedText && !input.note && !input.image && ['instagram', 'tiktok', 'x', 'threads', 'facebook'].includes(input.meta.platform);
      if (opaque) { parsed.board = 'Разное'; parsed.boardEmoji = '🗂️'; }
      return {
        title: parsed.title ? String(parsed.title).trim().slice(0, 90) : undefined,
        summary,
        tags,
        board: matchBoard(String(parsed.board || 'Разное'), input.boards) || 'Разное',
        boardEmoji: parsed.boardEmoji ? String(parsed.boardEmoji).trim().slice(0, 4) : undefined,
        model: j.modelVersion || model,
      };
    } catch (e: any) {
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

