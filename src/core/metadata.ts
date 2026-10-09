import type { Metadata, Platform } from './types';
import { detectPlatform } from './url';

const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
// Many social sites serve full OpenGraph tags only to link-preview bots.
const BOT_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)';
const TG_UA = 'TelegramBot (like TwitterBot)';

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 9000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { redirect: 'follow', ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any | null> {
  try {
    const r = await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/json', ...headers } });
    if (!r.ok) return null;
    const txt = await r.text();
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#x2F': '/', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»' };
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => safeCp(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => safeCp(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => ENT[n] ?? ENT[n.toLowerCase()] ?? m);
}
function safeCp(n: number) { try { return String.fromCodePoint(n); } catch { return ''; } }

function clean(s?: string | null, max = 2000): string | undefined {
  if (!s) return undefined;
  const t = decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : undefined;
}

/** Parse <meta> / <title> tags out of raw html (no DOM available in React Native). */
export function parseHtmlMeta(html: string): Record<string, string> {
  const head = html.slice(0, 600_000);
  const out: Record<string, string> = {};
  const tagRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(head))) {
    const tag = m[0];
    const attr = (name: string) => {
      const r = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
      return r ? (r[2] ?? r[3] ?? r[4] ?? '') : undefined;
    };
    const key = (attr('property') || attr('name') || attr('itemprop') || '').toLowerCase();
    const content = attr('content');
    if (key && content != null && !(key in out)) out[key] = content;
  }
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head);
  if (t) out['<title>'] = t[1];
  return out;
}

function absolutize(img: string | undefined, base: string): string | undefined {
  if (!img) return undefined;
  try { return new URL(decodeEntities(img), base).toString(); } catch { return undefined; }
}

async function fetchHtmlMeta(url: string, ua: string): Promise<{ meta: Record<string, string>; finalUrl: string } | null> {
  try {
    const r = await fetchWithTimeout(url, {
      headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'ru,en;q=0.8' },
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (ct && !/html|xml/i.test(ct)) return null;
    const html = await r.text();
    return { meta: parseHtmlMeta(html), finalUrl: r.url || url };
  } catch {
    return null;
  }
}

function fromOg(meta: Record<string, string>, base: string): Partial<Metadata> {
  const g = (...k: string[]) => k.map((x) => meta[x]).find((v) => v && v.trim());
  return {
    title: clean(g('og:title', 'twitter:title', '<title>'), 300),
    description: clean(g('og:description', 'twitter:description', 'description')),
    image: absolutize(g('og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src', 'thumbnailurl'), base),
    siteName: clean(g('og:site_name', 'application-name'), 80),
    author: clean(g('author', 'article:author', 'twitter:creator'), 120),
  };
}

const GENERIC_TITLES = /^(instagram|tiktok|tiktok - make your day|x|twitter|reddit|youtube|facebook|threads|log in|login|вход|sign up|just a moment\.\.\.|attention required!.*|access denied)$/i;
function useful(p: Partial<Metadata>): boolean {
  const titleOk = !!p.title && !GENERIC_TITLES.test(p.title.trim());
  return titleOk || !!p.description || !!p.image;
}

// ---------- platform strategies ----------

async function youtube(url: string): Promise<Partial<Metadata> | null> {
  const j = await getJson(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
  if (!j) return null;
  const res: Partial<Metadata> = { title: clean(j.title, 300), author: clean(j.author_name, 120), image: j.thumbnail_url, siteName: 'YouTube' };
  // oEmbed has no description; try page OG for it (works for normal videos)
  const page = await fetchHtmlMeta(url, BROWSER_UA);
  if (page) {
    const og = fromOg(page.meta, page.finalUrl);
    if (og.description && !/^(Делитесь видео|Enjoy the videos|Профессиональные видео|Auf YouTube findest)/i.test(og.description)) res.description = og.description;
    if (og.image && !res.image) res.image = og.image;
  }
  return res;
}

async function tiktok(url: string): Promise<Partial<Metadata> | null> {
  let u = url;
  if (/\/\/(vm|vt)\.tiktok\.com\/|tiktok\.com\/t\//.test(u)) {
    // short share link → resolve the redirect to the full /@user/video/<id> url
    try { u = (await fetchWithTimeout(u, { headers: { 'User-Agent': BROWSER_UA } })).url || u; } catch {}
    u = u.split('?')[0];
  }
  const j = await getJson(`https://www.tiktok.com/oembed?url=${encodeURIComponent(u)}`);
  if (!j || (!j.title && !j.thumbnail_url)) return null;
  return { title: clean(j.author_name ? `${j.author_name}` : j.title, 300), description: clean(j.title), author: clean(j.author_unique_id ? '@' + j.author_unique_id : j.author_name, 120), image: j.thumbnail_url, siteName: 'TikTok' };
}

async function xPost(url: string): Promise<Partial<Metadata> | null> {
  let finalUrl = url;
  if (/\/\/t\.co\//.test(url)) {
    try { finalUrl = (await fetchWithTimeout(url, { headers: { 'User-Agent': BROWSER_UA } })).url || url; } catch {}
  }
  const m = /\/(?:[^/]+)\/status(?:es)?\/(\d+)/.exec(finalUrl);
  if (m) {
    // fxtwitter: public JSON mirror of a tweet (text + media), no auth required
    const j = await getJson(`https://api.fxtwitter.com/status/${m[1]}`);
    const t = j?.tweet;
    if (t) {
      const img = t.media?.photos?.[0]?.url || t.media?.videos?.[0]?.thumbnail_url || t.media?.mosaic?.formats?.jpeg || t.quote?.media?.photos?.[0]?.url || t.author?.avatar_url;
      const article = t.article ? `${t.article.title || ''}. ${t.article.preview_text || ''}` : '';
      return { title: clean(`${t.author?.name ?? ''} (@${t.author?.screen_name ?? ''})`, 200), description: clean((t.text || t.raw_text?.text || '') + (article ? ' ' + article : '') + (t.quote?.text ? `\n«${t.quote.text}»` : '')), author: t.author?.screen_name ? '@' + t.author.screen_name : undefined, image: img, siteName: 'X' };
    }
  }
  if (m) {
    // X's own embed-widget endpoint (works without auth, also from datacenter IPs)
    const token = ((Number(m[1]) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
    const t = await getJson(`https://cdn.syndication.twimg.com/tweet-result?id=${m[1]}&lang=ru&token=${token}`);
    if (t?.text != null || t?.user) {
      const img = t.mediaDetails?.[0]?.media_url_https || t.photos?.[0]?.url || t.video?.poster || t.card?.binding_values?.thumbnail_image_large?.image_value?.url || t.user?.profile_image_url_https?.replace('_normal', '_400x400');
      const art = t.article ? `${t.article.title || ''}. ${t.article.preview_text || ''}` : '';
      return { title: clean(`${t.user?.name ?? ''} (@${t.user?.screen_name ?? ''})`, 200), description: clean((t.text || '') + (art ? ' ' + art : '') + (t.quoted_tweet?.text ? `\n«${t.quoted_tweet.text}»` : '')), author: t.user?.screen_name ? '@' + t.user.screen_name : undefined, image: img, siteName: 'X' };
    }
  }
  const o = await getJson(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(finalUrl)}`);
  if (o?.html) {
    const p = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(o.html);
    return { title: clean(o.author_name, 200), description: clean(p ? p[1] : o.html), author: clean(o.author_name), siteName: 'X' };
  }
  return null;
}

async function reddit(url: string): Promise<Partial<Metadata> | null> {
  let u = url;
  if (/redd\.it|\/s\//.test(u)) {
    try { u = (await fetchWithTimeout(u, { headers: { 'User-Agent': BROWSER_UA } })).url || u; } catch {}
  }
  const base = u.split('?')[0].replace(/\/$/, '');
  const j = await getJson(base + '.json?raw_json=1', { 'User-Agent': 'android:post-saver:1.0 (personal)' });
  const post = Array.isArray(j) ? j[0]?.data?.children?.[0]?.data : null;
  if (post) {
    const prev = post.preview?.images?.[0]?.source?.url;
    const thumb = /^https?:/.test(post.thumbnail || '') ? post.thumbnail : undefined;
    return { url: 'https://www.reddit.com' + post.permalink, title: clean(post.title, 300), description: clean(post.selftext || (post.url_overridden_by_dest ? 'Ссылка: ' + post.url_overridden_by_dest : '')), author: `r/${post.subreddit} · u/${post.author}`, image: prev || thumb, siteName: 'Reddit' };
  }
  const o = await getJson(`https://www.reddit.com/oembed?url=${encodeURIComponent(base)}`);
  if (o?.title) return { title: clean(o.title, 300), author: clean(o.author_name), siteName: 'Reddit' };
  return null;
}

function igEmbedUrl(url: string): string | null {
  const m = /instagram\.com\/(?:[^/]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(url);
  if (!m) return null;
  return `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed/captioned/`;
}

async function instagram(url: string): Promise<Partial<Metadata> | null> {
  const res: Partial<Metadata> = { siteName: 'Instagram' };
  // 1) the public embed page carries the caption text + preview image
  const embed = igEmbedUrl(url);
  if (embed) {
    try {
      const r = await fetchWithTimeout(embed, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'ru,en;q=0.8' } });
      if (r.ok) {
        const html = await r.text();
        const cap = /<div class="Caption">([\s\S]*?)<div class="Footer"/.exec(html) || /<div class="Caption">([\s\S]*?)<\/div>/.exec(html);
        if (cap) {
          const user = /class="CaptionUsername"[^>]*>([^<]+)</.exec(cap[1]);
          const body = cap[1].replace(/<a class="CaptionUsername"[\s\S]*?<\/a>/, '').replace(/<br\s*\/?>/gi, '\n');
          res.description = clean(body);
          if (user) res.author = '@' + user[1].trim();
        }
        const img = /<img[^>]*class="EmbeddedMediaImage"[^>]*src="([^"]+)"/.exec(html) || /<img[^>]*src="([^"]+)"[^>]*class="EmbeddedMediaImage"/.exec(html);
        if (img) res.image = decodeEntities(img[1]);
        if (!res.author) { const u = /class="UsernameText">([^<]+)</.exec(html); if (u) res.author = '@' + u[1].trim(); }
      }
    } catch {}
  }
  // 2) OG tags (Instagram serves them to link-preview bots; title = "Author • Instagram reel")
  if (!res.image || !res.description) {
    for (const ua of [BOT_UA, TG_UA]) {
      const page = await fetchHtmlMeta(url, ua);
      if (!page || /accounts\/login/.test(page.finalUrl)) continue;
      const og = fromOg(page.meta, page.finalUrl);
      res.image = res.image || og.image;
      res.description = res.description || og.description;
      res.title = res.title || og.title;
      if (res.image) break;
    }
  }
  if (!res.title && res.author) res.title = `${res.author} · Instagram`;
  return useful(res) ? res : null;
}

async function generic(url: string): Promise<Partial<Metadata> | null> {
  for (const ua of [BROWSER_UA, BOT_UA]) {
    const page = await fetchHtmlMeta(url, ua);
    if (page) {
      const og = fromOg(page.meta, page.finalUrl);
      if (useful(og)) return { ...og, url: page.meta['og:url'] && /^https?:/.test(page.meta['og:url']) ? decodeEntities(page.meta['og:url']) : page.finalUrl };
    }
  }
  return null;
}

const STRATEGIES: Partial<Record<Platform, (u: string) => Promise<Partial<Metadata> | null>>> = {
  youtube, tiktok, x: xPost, reddit, instagram, threads: instagram, facebook: instagram,
};

/**
 * Best-effort metadata for a shared link. Never throws: when a site blocks us
 * we return { blocked: true } and the AI step works from the shared text alone.
 */
export async function fetchMetadata(url: string): Promise<Metadata> {
  const platform = detectPlatform(url);
  const tries: [string, (u: string) => Promise<Partial<Metadata> | null>][] = [];
  const s = STRATEGIES[platform];
  if (s) tries.push([platform, s]);
  tries.push(['og', generic]); // generic OpenGraph as last resort
  for (const [name, fn] of tries) {
    try {
      const r = await fn(url);
      if (r && useful(r)) {
        return { platform, source: name, ...r, url: r.url || url };
      }
    } catch {
      // try the next strategy
    }
  }
  return { url, platform, blocked: true, source: 'none' };
}
