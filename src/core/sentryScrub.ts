// Pure scrubbing helpers for Sentry events (no SDK import, unit-testable).
// Goal: only crash/error type, message (URLs stripped) and stack trace leave the device.
const URL_RE = /\b(?:https?|ftp|content|file|intent|instagram|pinbox|grabbit):\/\/[^\s"'<>)]+/gi;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const MAX_MSG = 300;

export function scrubText(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  let out = s.replace(URL_RE, '<url>').replace(EMAIL_RE, '<email>');
  if (out.length > MAX_MSG) out = out.slice(0, MAX_MSG) + '…';
  return out;
}

// Keep only non-sensitive breadcrumb categories, without any data payload.
export function scrubBreadcrumb<T extends Record<string, any>>(b: T | null | undefined): T | null {
  if (!b) return null;
  const cat = String(b.category || '');
  const type = String(b.type || '');
  if (/^(console|navigation|xhr|fetch|http|ui\.|touch|sentry\.)/.test(cat) || type === 'http' || type === 'navigation') return null;
  const out: any = { ...b };
  delete out.data;
  if (out.message) out.message = scrubText(out.message);
  return out;
}

const DROP_CONTEXTS = ['device_name', 'culture'];

export function scrubEvent<T extends Record<string, any>>(e: T | null | undefined): T | null {
  if (!e) return null;
  const ev: any = { ...e };
  delete ev.user;
  delete ev.request;
  delete ev.extra;
  delete ev.server_name;
  delete ev.breadcrumbs;
  if (ev.message) ev.message = typeof ev.message === 'string' ? scrubText(ev.message) : { ...ev.message, formatted: scrubText(ev.message.formatted), message: scrubText(ev.message.message), params: undefined };
  if (ev.exception?.values) {
    ev.exception = { ...ev.exception, values: ev.exception.values.map((v: any) => ({ ...v, value: scrubText(v.value) })) };
  }
  if (ev.contexts) {
    const c: any = { ...ev.contexts };
    for (const k of DROP_CONTEXTS) delete c[k];
    if (c.device) { c.device = { ...c.device }; delete c.device.name; }
    ev.contexts = c;
  }
  if (ev.tags) {
    const t: any = {};
    for (const [k, v] of Object.entries(ev.tags)) t[k] = typeof v === 'string' ? scrubText(v) : v;
    ev.tags = t;
  }
  return ev;
}
