export const C = {
  bg: '#FAF7F5',
  card: '#FFFFFF',
  text: '#1D1B1A',
  sub: '#6F6A66',
  faint: '#A39E99',
  line: '#ECE6E1',
  accent: '#E8465B',
  accentSoft: '#FDE8EB',
  chip: '#F1ECE8',
  ok: '#2E9E6A',
  warn: '#D98A1C',
};

export const PLATFORM_COLOR: Record<string, string> = {
  instagram: '#D62976', tiktok: '#111111', youtube: '#FF0033', x: '#111111', reddit: '#FF4500',
  telegram: '#2AABEE', threads: '#111111', facebook: '#1877F2', linkedin: '#0A66C2', pinterest: '#E60023',
  vk: '#0077FF', github: '#24292F', web: '#6F6A66',
};

export const PLATFORM_ICON: Record<string, string> = {
  instagram: 'logo-instagram', tiktok: 'logo-tiktok', youtube: 'logo-youtube', x: 'logo-x', reddit: 'logo-reddit',
  telegram: 'paper-plane', threads: 'at', facebook: 'logo-facebook', linkedin: 'logo-linkedin', pinterest: 'logo-pinterest',
  vk: 'logo-vk', github: 'logo-github', web: 'globe-outline',
};

export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} дн назад`;
  const date = new Date(ts);
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
