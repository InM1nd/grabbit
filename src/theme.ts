import { createContext, useContext } from 'react';

export interface Palette {
  dark: boolean;
  bg: string; card: string; elevated: string; text: string; sub: string; faint: string; line: string;
  accent: string; accentSoft: string; onAccent: string; chip: string; chipActive: string; onChipActive: string;
  ok: string; warn: string; danger: string; overlay: string; tabbar: string;
}

export const LIGHT: Palette = {
  dark: false,
  bg: '#FFFFFF', card: '#F4F4F5', elevated: '#FFFFFF', text: '#18181B', sub: '#52525B', faint: '#A1A1AA', line: '#E4E4E7',
  accent: '#EF4444', accentSoft: '#FEF2F2', onAccent: '#FFFFFF', chip: '#F4F4F5', chipActive: '#18181B', onChipActive: '#FFFFFF',
  ok: '#16A34A', warn: '#D97706', danger: '#DC2626', overlay: 'rgba(0,0,0,0.4)', tabbar: 'rgba(255,255,255,0.97)',
};

export const DARK: Palette = {
  dark: true,
  bg: '#0B0B0D', card: '#18181B', elevated: '#1F1F23', text: '#F4F4F5', sub: '#A1A1AA', faint: '#71717A', line: '#27272A',
  accent: '#F87171', accentSoft: '#2A1414', onAccent: '#0B0B0D', chip: '#18181B', chipActive: '#F4F4F5', onChipActive: '#0B0B0D',
  ok: '#4ADE80', warn: '#FBBF24', danger: '#F87171', overlay: 'rgba(0,0,0,0.6)', tabbar: 'rgba(11,11,13,0.97)',
};

export const ThemeContext = createContext<Palette>(LIGHT);
export const useColors = () => useContext(ThemeContext);

export const PLATFORM_COLOR: Record<string, string> = {
  instagram: '#D62976', tiktok: '#25F4EE', youtube: '#FF0033', x: '#71717A', reddit: '#FF4500',
  telegram: '#2AABEE', threads: '#71717A', facebook: '#1877F2', linkedin: '#0A66C2', pinterest: '#E60023',
  vk: '#0077FF', github: '#71717A', web: '#71717A',
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
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
