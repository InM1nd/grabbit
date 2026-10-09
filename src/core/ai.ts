import type { AiResult, Metadata } from './types';
import { PLATFORM_LABEL } from './url';

// 3.5-flash: good quality + reliable on the free tier; the -latest aliases are fallbacks (3.8-flash often 503s under load).
export const GEMINI_MODELS = ['gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-flash-latest'];
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

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

export async function analyzePost(input: AiInput, apiKey: string, timeoutMs = 20000): Promise<AiResult> {
  if (!apiKey) throw new AiError('Нет ключа Gemini', false);
  const prompt = buildPrompt(input);
  const bodyFor = (model: string) => JSON.stringify({
    contents: [{ role: 'user', parts: [
      { text: prompt },
      ...(input.image ? [{ inlineData: { mimeType: input.image.mimeType, data: input.image.data } }] : []),
    ] }],
    generationConfig: {
      responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.4,
      ...(model.includes('lite') ? {} : { thinkingConfig: { thinkingLevel: 'low' } }),
    },
  });
  let lastErr: AiError = new AiError('Gemini недоступен', true);
  for (const model of GEMINI_MODELS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
        // 429 quota / 5xx overload: try the next model, and retry later. 400/403 = bad key/request.
        lastErr = new AiError(msg, r.status === 429 || r.status >= 500 || r.status === 404, r.status);
        continue;
      }
      const j = JSON.parse(txt);
      const out = j.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
      const parsed = JSON.parse(out.replace(/^```(?:json)?|```$/g, '').trim());
      const tags: string[] = Array.isArray(parsed.tags)
        ? [...new Set<string>(parsed.tags.map((t: any) => String(t).toLowerCase().replace(/^#/, '').trim()).filter(Boolean))].slice(0, 6)
        : [];
      // Opaque links (IG/TikTok/X ids) with no metadata: don't let the model guess a topic board.
      const opaque = input.meta.blocked && !input.sharedText && !input.note && !input.image && ['instagram', 'tiktok', 'x', 'threads', 'facebook'].includes(input.meta.platform);
      if (opaque) { parsed.board = 'Разное'; parsed.boardEmoji = '🗂️'; }
      return {
        title: parsed.title ? String(parsed.title).trim().slice(0, 90) : undefined,
        summary: String(parsed.summary || '').trim(),
        tags,
        board: matchBoard(String(parsed.board || 'Разное'), input.boards) || 'Разное',
        boardEmoji: parsed.boardEmoji ? String(parsed.boardEmoji).trim().slice(0, 4) : undefined,
        model: j.modelVersion || model,
      };
    } catch (e: any) {
      // network error / timeout / malformed JSON → retry later
      lastErr = e instanceof AiError ? e : new AiError(e?.name === 'AbortError' ? 'Таймаут Gemini' : String(e?.message || e), true);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
