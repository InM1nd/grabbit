// Built-in (default) boards: stored with a stable key, shown in the UI language.
// Other boards keep their own name; AI-created ones also carry name_ru/name_en/name_uk translations.
export type BoardLang = 'ru' | 'en' | 'uk';

export const DEFAULT_BOARDS: Record<string, { ru: string; en: string; uk: string; emoji: string }> = {
  misc: { ru: 'Разное', en: 'Misc', uk: 'Різне', emoji: '🗂️' },
  'ai-tools': { ru: 'ИИ-инструменты', en: 'AI tools', uk: 'ШІ-інструменти', emoji: '🤖' },
  programming: { ru: 'Программирование', en: 'Programming', uk: 'Програмування', emoji: '💻' },
  gadgets: { ru: 'Гаджеты', en: 'Gadgets', uk: 'Гаджети', emoji: '📱' },
  design: { ru: 'Дизайн и UI', en: 'Design & UI', uk: 'Дизайн і UI', emoji: '🎨' },
  productivity: { ru: 'Продуктивность', en: 'Productivity', uk: 'Продуктивність', emoji: '⚡' },
};

/**
 * One-line "what belongs here" for each default board, shown to the model next to the name.
 * Names alone ("Дизайн и UI") are too vague for posts that only hint at a topic.
 * User-created boards have no hint: they are described by their frequent tags and recent post titles.
 */
export const BOARD_HINTS: Record<string, string> = {
  misc: 'запасной вариант: только если тему не понять ни по тексту, ни по картинке',
  'ai-tools': 'ChatGPT, Claude, Gemini, нейросети, промпты, ИИ-агенты, генерация картинок/видео/музыки',
  programming: 'код, языки и фреймворки, GitHub, веб/мобильная разработка, DevOps, алгоритмы',
  gadgets: 'телефоны, ноутбуки, часы, наушники, обзоры техники, умный дом, электроника',
  design: 'UI/UX, Figma, шрифты, цвета, иллюстрации, брендинг, референсы',
  productivity: 'заметки, планирование, привычки, тайм-менеджмент, Notion/Obsidian, автоматизация дел',
};

/** Legacy / AI spellings of the default boards (normalized: lowercase, no punctuation). */
const SYNONYMS: Record<string, string[]> = {
  misc: ['miscellaneous', 'other', 'others', 'misc stuff', 'другое', 'прочее', 'разное и прочее', 'інше', 'різне інше', 'всякое', 'без темы', 'uncategorized', 'general', 'общее', 'загальне'],
  'ai-tools': ['ai', 'ai tool', 'ai tools', 'ии', 'ии инструменты', 'инструменты ии', 'нейросети', 'нейросеть', 'искусственный интеллект', 'artificial intelligence', 'ші', 'ші інструменти', 'інструменти ші', 'нейромережі', 'штучний інтелект'],
  programming: ['coding', 'code', 'development', 'software development', 'dev', 'программирование и разработка', 'разработка', 'кодинг', 'код', 'розробка', 'кодинг і розробка'],
  gadgets: ['gadget', 'tech gadgets', 'devices', 'гаджет', 'девайсы', 'устройства', 'пристрої', 'гаджеты и техника'],
  design: ['design', 'ui', 'ux', 'ui ux', 'design and ui', 'design ui', 'ui design', 'дизайн', 'дизайн ui', 'дизайн и интерфейсы', 'ui ux дизайн', 'дизайн та ui', 'дизайн і інтерфейси'],
  productivity: ['productivity tips', 'продуктивность и тайм менеджмент', 'тайм менеджмент', 'эффективность', 'продуктивність і тайм менеджмент', 'ефективність'],
};

/** Loose form for comparing board names: lowercase, ё→е, punctuation/&/и/і/and collapsed. */
export function normName(s: string): string {
  return (s || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/[«»"'`’.,:;!?()\[\]{}\-–—_/\\|+*]/g, ' ').replace(/&/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
/** Same, ignoring connector words so "Design & UI" == "Дизайн и UI" style variants line up. */
const loose = (s: string) => normName(s).split(' ').filter((w) => !['и', 'і', 'та', 'and', 'й'].includes(w)).join(' ');

const LOOKUP = (() => {
  const m = new Map<string, string>();
  for (const [k, v] of Object.entries(DEFAULT_BOARDS)) for (const n of [v.ru, v.en, v.uk]) m.set(loose(n), k);
  for (const [k, list] of Object.entries(SYNONYMS)) for (const n of list) m.set(loose(n), k);
  return m;
})();

/** Key of a default board whose name (any language, legacy spelling) matches, else null. */
export function defaultBoardKey(name: string): string | null {
  const n = loose(name);
  return n ? LOOKUP.get(n) ?? null : null;
}

export interface BoardNames { name: string; key?: string | null; nameRu?: string | null; nameEn?: string | null; nameUk?: string | null }

/** Name to show: localized for default boards, stored translation for AI boards, stored name otherwise. */
export function boardDisplayName(name: string, key: string | null | undefined, lang: BoardLang, tr?: { ru?: string | null; en?: string | null; uk?: string | null }): string {
  const d = key ? DEFAULT_BOARDS[key] : undefined;
  if (d) return d[lang];
  return (tr?.[lang] || '').trim() || name;
}

/** All names a board is known under (for matching AI output). */
export function boardAliases(b: BoardNames): string[] {
  const d = b.key ? DEFAULT_BOARDS[b.key] : undefined;
  return [b.name, b.nameRu, b.nameEn, b.nameUk, ...(d ? [d.ru, d.en, d.uk] : [])].filter((x): x is string => !!x && !!x.trim());
}

/** Find the board whose name (in any language) matches `name`. */
export function findBoardByName<T extends BoardNames>(name: string, boards: T[]): T | undefined {
  const n = loose(name);
  if (!n) return undefined;
  const k = defaultBoardKey(name);
  if (k) { const hit = boards.find((b) => b.key === k); if (hit) return hit; }
  return boards.find((b) => boardAliases(b).some((a) => loose(a) === n));
}

export const miscName = (lang: BoardLang) => DEFAULT_BOARDS.misc[lang];
