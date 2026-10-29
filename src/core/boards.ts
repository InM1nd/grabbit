// Built-in (default) boards: stored with a stable key, shown in the UI language.
// Boards the user created or renamed have no key and keep their own name.
export type BoardLang = 'ru' | 'en' | 'uk';

export const DEFAULT_BOARDS: Record<string, { ru: string; en: string; uk: string; emoji: string }> = {
  misc: { ru: 'Разное', en: 'Misc', uk: 'Різне', emoji: '🗂️' },
  'ai-tools': { ru: 'ИИ-инструменты', en: 'AI tools', uk: 'ШІ-інструменти', emoji: '🤖' },
  programming: { ru: 'Программирование', en: 'Programming', uk: 'Програмування', emoji: '💻' },
  gadgets: { ru: 'Гаджеты', en: 'Gadgets', uk: 'Гаджети', emoji: '📱' },
  design: { ru: 'Дизайн и UI', en: 'Design & UI', uk: 'Дизайн і UI', emoji: '🎨' },
  productivity: { ru: 'Продуктивность', en: 'Productivity', uk: 'Продуктивність', emoji: '⚡' },
};

const norm = (s: string) => s.trim().replace(/^["«]|["»]$/g, '').toLowerCase();

/** Key of a default board whose name (in any language) matches, else null. */
export function defaultBoardKey(name: string): string | null {
  const n = norm(name);
  if (!n) return null;
  for (const [k, v] of Object.entries(DEFAULT_BOARDS)) if ([v.ru, v.en, v.uk].some((x) => x.toLowerCase() === n)) return k;
  if (n === 'miscellaneous' || n === 'other' || n === 'другое' || n === 'інше') return 'misc';
  return null;
}

/** Name to show: localized for default boards, stored name otherwise. */
export function boardDisplayName(name: string, key: string | null | undefined, lang: BoardLang): string {
  const d = key ? DEFAULT_BOARDS[key] : undefined;
  return d ? d[lang] : name;
}

export const miscName = (lang: BoardLang) => DEFAULT_BOARDS.misc[lang];
