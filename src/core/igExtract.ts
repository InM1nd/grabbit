/**
 * Instagram extraction for posts that are only visible when logged in.
 * The app loads the post in a hidden WebView that carries the user's Instagram
 * session; the injected script (IG_INJECT_JS) collects raw material and this
 * pure module turns it into metadata. Pure TS → unit-tested against saved HTML/JSON.
 */
import { decodeEntities, parseHtmlMeta } from './metadata';

export interface IgRawPage {
  url: string;
  html?: string;          // document.documentElement.outerHTML (truncated)
  api?: string | null;    // body of /api/v1/media/<id>/info/ or ?__a=1 (JSON text)
  dom?: { h1?: string | null; title?: string; imgs?: { src: string; alt: string; w: number }[] };
  loggedIn?: boolean;
  error?: string;
}

export interface IgPost {
  caption?: string;
  author?: string;   // @username
  authorName?: string;
  image?: string;
  source: 'api' | 'embedded-json' | 'og' | 'dom';
}

const SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Instagram shortcode → numeric media id (string; uses BigInt). */
export function shortcodeToMediaId(code: string): string | null {
  const c = code.slice(0, 11);
  let id = BigInt(0);
  for (const ch of c) {
    const i = SHORTCODE_ALPHABET.indexOf(ch);
    if (i < 0) return null;
    id = id * BigInt(64) + BigInt(i);
  }
  return id.toString();
}

export function igShortcode(url: string): string | null {
  const m = /instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/.exec(url);
  return m ? m[1] : null;
}

function bestCandidate(item: any): string | undefined {
  const pick = (it: any) => it?.image_versions2?.candidates?.[0]?.url || it?.display_url || it?.thumbnail_src;
  return pick(item) || pick(item?.carousel_media?.[0]) || pick(item?.edge_sidecar_to_children?.edges?.[0]?.node);
}

/** Normalise one media item in either the v1 API ("items") or GraphQL ("shortcode_media") shape. */
export function fromMediaItem(item: any): Omit<IgPost, 'source'> | null {
  if (!item || typeof item !== 'object') return null;
  const caption = item.caption?.text ?? item.edge_media_to_caption?.edges?.[0]?.node?.text ?? (typeof item.caption === 'string' ? item.caption : undefined);
  const user = item.user || item.owner;
  const res = {
    caption: caption ? String(caption).trim() : undefined,
    author: user?.username ? '@' + user.username : undefined,
    authorName: user?.full_name || undefined,
    image: bestCandidate(item),
  };
  return res.caption || res.image || res.author ? res : null;
}

/** Find the JSON value following `"key":` at position `from` by bracket matching. */
export function sliceJsonValue(text: string, from: number): string | null {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '{' && text[i] !== '[') return null;
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      if (stack.pop() !== ch) return null;
      if (!stack.length) return text.slice(i, j + 1);
    }
  }
  return null;
}

/** Look for embedded media JSON in a (logged-in) Instagram page. */
export function fromEmbeddedJson(html: string, shortcode?: string | null): Omit<IgPost, 'source'> | null {
  const keys = ['"xdt_api__v1__media__shortcode__web_info"', '"shortcode_media"', '"items"'];
  for (const key of keys) {
    let pos = 0;
    for (let n = 0; n < 40; n++) {
      const k = html.indexOf(key + ':', pos);
      if (k < 0) break;
      pos = k + key.length + 1;
      const raw = sliceJsonValue(html, pos);
      if (!raw || raw.length < 20) continue;
      let val: any;
      try { val = JSON.parse(raw); } catch { continue; }
      const items: any[] = Array.isArray(val) ? val : Array.isArray(val?.items) ? val.items : [val];
      const match = items.find((it) => it && (it.code === shortcode || it.shortcode === shortcode)) || (shortcode ? null : items[0]);
      const cand = match || items.find((it) => it?.caption || it?.edge_media_to_caption);
      const r = fromMediaItem(cand);
      if (r && (r.caption || r.image)) return r;
    }
  }
  return null;
}

/** og:description looks like: `12 likes, 3 comments - user on October 1, 2026: "caption". ` */
export function fromOgTags(html: string): Omit<IgPost, 'source'> | null {
  const meta = parseHtmlMeta(html);
  const desc = decodeEntities(meta['og:description'] || meta['description'] || '');
  const title = decodeEntities(meta['og:title'] || meta['twitter:title'] || '');
  const image = meta['og:image'] ? decodeEntities(meta['og:image']) : undefined;
  let caption: string | undefined;
  let author: string | undefined;
  const m = /-\s*([A-Za-z0-9._]+)\s+(?:on\s+)?[^:"]+:\s*"([\s\S]*)"\s*\.?\s*$/.exec(desc) || /^([A-Za-z0-9._]+)\s+on\s+[^:]+:\s*"([\s\S]*)"/.exec(desc);
  if (m) { author = '@' + m[1]; caption = m[2]; }
  if (!caption) {
    const t = /:\s*"([\s\S]*)"\s*$/.exec(title) || /:\s*«([\s\S]*)»\s*$/.exec(title);
    if (t) caption = t[1];
  }
  if (!author) {
    const a = /\(@([A-Za-z0-9._]+)\)/.exec(title) || /@([A-Za-z0-9._]+)/.exec(title);
    if (a) author = '@' + a[1];
  }
  const res = { caption: caption?.trim(), author, image };
  return res.caption || res.image ? res : null;
}

function fromDom(dom: IgRawPage['dom']): Omit<IgPost, 'source'> | null {
  if (!dom) return null;
  const big = (dom.imgs || []).filter((i) => i.w >= 300 && /cdninstagram|fbcdn/.test(i.src)).sort((a, b) => b.w - a.w)[0];
  const caption = dom.h1?.trim() || undefined;
  // Instagram alt texts ("Photo by X on … May be an image of text that says '…'") are useful context
  const res = { caption: caption || big?.alt || undefined, image: big?.src };
  return res.caption || res.image ? res : null;
}

const LOGIN_WALL = /accounts\/login|challenge\/|"is_logged_in":false/;

/** Turn what the hidden WebView collected into post metadata (best source first). */
export function extractInstagram(raw: IgRawPage): IgPost | null {
  const code = igShortcode(raw.url);
  if (raw.api) {
    try {
      const j = JSON.parse(raw.api);
      const item = j?.items?.[0] ?? j?.graphql?.shortcode_media ?? j?.data?.xdt_shortcode_media ?? j?.data?.shortcode_media;
      const r = fromMediaItem(item);
      if (r) return { ...r, source: 'api' };
    } catch { /* not JSON (login wall html) */ }
  }
  if (raw.html) {
    const e = fromEmbeddedJson(raw.html, code);
    if (e) return { ...e, source: 'embedded-json' };
    const o = fromOgTags(raw.html);
    if (o && o.caption) return { ...o, source: 'og' };
    const d = fromDom(raw.dom);
    if (d) return { ...d, author: o?.author, image: d.image || o?.image, source: 'dom' };
    if (o) return { ...o, source: 'og' };
  } else {
    const d = fromDom(raw.dom);
    if (d) return { ...d, source: 'dom' };
  }
  void LOGIN_WALL;
  return null;
}

export function looksLikeLoginWall(raw: IgRawPage): boolean {
  return LOGIN_WALL.test(raw.url) || (!!raw.html && /"is_logged_in":false/.test(raw.html) && !raw.api);
}

/**
 * Script injected into the hidden WebView after the post page loads.
 * Runs in Instagram's origin with the user's cookies, so the private media API works.
 */
export const IG_INJECT_JS = `
(function(){
  if (window.__pinboxRan) return; window.__pinboxRan = true;
  var A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function idOf(code){ try{ var id=BigInt(0); code=code.slice(0,11); for(var i=0;i<code.length;i++){ var k=A.indexOf(code[i]); if(k<0) return null; id=id*BigInt(64)+BigInt(k);} return id.toString(); }catch(e){ return null; } }
  function send(o){ try{ window.ReactNativeWebView.postMessage(JSON.stringify(o)); }catch(e){} }
  async function get(u){ try{ var r=await fetch(u,{credentials:'include',headers:{'X-IG-App-ID':'936619743392459','X-Requested-With':'XMLHttpRequest','Accept':'application/json'}}); var t=await r.text(); return (t && t.trim()[0]==='{') ? t.slice(0,800000) : null; }catch(e){ return null; } }
  setTimeout(async function(){
    var out={type:'ig-page', url: location.href, loggedIn: /ds_user_id=/.test(document.cookie)};
    try{
      var m=location.pathname.match(/\\/(?:p|reel|reels|tv)\\/([A-Za-z0-9_-]+)/);
      if(m){
        var id=idOf(m[1]);
        if(id) out.api = await get('/api/v1/media/'+id+'/info/');
        if(!out.api) out.api = await get('/p/'+m[1]+'/?__a=1&__d=dis');
      }
    }catch(e){ out.error=String(e); }
    try{
      var h1=document.querySelector('h1'); 
      var imgs=[].slice.call(document.images||[]).slice(0,40).map(function(i){return {src:i.currentSrc||i.src, alt:i.alt||'', w:i.naturalWidth||i.width||0};});
      out.dom={h1: h1 ? h1.innerText : null, title: document.title, imgs: imgs};
      out.html=document.documentElement.outerHTML.slice(0,1500000);
    }catch(e){}
    send(out);
  }, 1800);
})(); true;
`;

/** Injected on every page of the login WebView: reports whether the session cookie exists. */
export const IG_LOGIN_CHECK_JS = `
(function(){
  function check(){ try{ var m=document.cookie.match(/ds_user_id=(\\d+)/); window.ReactNativeWebView.postMessage(JSON.stringify({type:'ig-login', loggedIn: !!m, userId: m ? m[1] : null, url: location.href})); }catch(e){} }
  check(); setTimeout(check, 1500);
})(); true;
`;

/** Logs out of the web session (same request instagram.com makes). */
export const IG_LOGOUT_JS = `
(async function(){
  try{
    var csrf=(document.cookie.match(/csrftoken=([^;]+)/)||[])[1]||'';
    var uid=(document.cookie.match(/ds_user_id=(\\d+)/)||[])[1]||'';
    await fetch('/api/v1/web/accounts/logout/ajax/',{method:'POST',credentials:'include',headers:{'X-CSRFToken':csrf,'X-IG-App-ID':'936619743392459','Content-Type':'application/x-www-form-urlencoded'},body:'one_tap_app_login=0&user_id='+uid});
  }catch(e){}
  setTimeout(function(){ var m=document.cookie.match(/ds_user_id=(\\d+)/); window.ReactNativeWebView.postMessage(JSON.stringify({type:'ig-logout', loggedIn: !!m})); }, 800);
})(); true;
`;
