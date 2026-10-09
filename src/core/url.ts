import type { Platform } from './types';

const URL_RE = /https?:\/\/[^\s<>"'«»]+/i;

/** Pull the first http(s) url out of arbitrary shared text. */
export function extractUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(URL_RE);
  if (!m) return null;
  return m[0].replace(/[.,;:!?)\]]+$/, '');
}

/** Text the user shared besides the link (TikTok/Insta often prepend a caption). */
export function extraText(text: string | null | undefined, url: string | null): string {
  if (!text) return '';
  let t = url ? text.replace(url, ' ') : text;
  t = t.replace(/\s+/g, ' ').trim();
  return t.length > 2 ? t.slice(0, 1500) : '';
}

export function detectPlatform(url: string): Platform {
  let h = '';
  try { h = new URL(url).hostname.toLowerCase().replace(/^www\.|^m\./, ''); } catch { return 'web'; }
  const is = (...d: string[]) => d.some((x) => h === x || h.endsWith('.' + x));
  if (is('instagram.com', 'instagr.am')) return 'instagram';
  if (is('tiktok.com')) return 'tiktok';
  if (is('youtube.com', 'youtu.be')) return 'youtube';
  if (is('twitter.com', 'x.com', 't.co', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com')) return 'x';
  if (is('reddit.com', 'redd.it')) return 'reddit';
  if (is('t.me', 'telegram.me')) return 'telegram';
  if (is('threads.net', 'threads.com')) return 'threads';
  if (is('facebook.com', 'fb.watch', 'fb.com')) return 'facebook';
  if (is('linkedin.com', 'lnkd.in')) return 'linkedin';
  if (is('pinterest.com', 'pin.it')) return 'pinterest';
  if (is('vk.com', 'vk.ru', 'vkvideo.ru')) return 'vk';
  if (is('github.com')) return 'github';
  return 'web';
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', x: 'X', reddit: 'Reddit',
  telegram: 'Telegram', threads: 'Threads', facebook: 'Facebook', linkedin: 'LinkedIn',
  pinterest: 'Pinterest', vk: 'VK', github: 'GitHub', web: 'Сайт',
};

/** Strip tracking params so the same post shared twice is recognised as a duplicate. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const drop = [/^utm_/, /^igsh$/, /^igshid$/, /^si$/, /^s$/, /^t$/, /^ref/, /^share/, /^_r$/, /^_t$/, /^feature$/, /^is_from_webapp$/, /^sender_device$/, /^fbclid$/];
    const isYtWatch = /youtube\.com$/.test(u.hostname) && u.pathname === '/watch';
    for (const k of [...u.searchParams.keys()]) {
      if (isYtWatch && k === 'v') continue;
      if (k === 't' && /youtu/.test(u.hostname)) continue; // keep yt timestamp
      if (drop.some((r) => r.test(k))) u.searchParams.delete(k);
    }
    // These platforms never need query params to identify a post (Instagram adds dlrf/igsh/_r...).
    if (/(^|\.)(instagram\.com|tiktok\.com|threads\.net|threads\.com)$/.test(u.hostname)) u.search = '';
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('?')) s = s.slice(0, -1);
    return s;
  } catch {
    return url;
  }
}
