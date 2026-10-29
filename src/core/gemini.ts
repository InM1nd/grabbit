/** Where Gemini requests go: the user's own key (direct) or the Grabbit proxy (anonymous device ID + daily limit). */
export const GEMINI_DIRECT = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiAuthObj { key?: string; proxyUrl?: string; deviceId?: string }
/** A bare string is treated as an own API key (back-compat for scripts/tests). */
export type GeminiAuth = string | GeminiAuthObj;

const norm = (a: GeminiAuth): GeminiAuthObj => (typeof a === 'string' ? { key: a } : a || {});

export function canUseGemini(a: GeminiAuth): boolean {
  const x = norm(a);
  return !!(x.key || (x.proxyUrl && x.deviceId));
}

/** Build the request URL + headers for a path like `models/gemini-x:generateContent`. Own key wins over the proxy. */
export function geminiTarget(a: GeminiAuth, path: string): { url: string; headers: Record<string, string> } | null {
  const x = norm(a);
  const p = path.replace(/^\/+/, '');
  if (x.key) return { url: `${GEMINI_DIRECT}/${p}`, headers: { 'x-goog-api-key': x.key } };
  if (x.proxyUrl && x.deviceId) return { url: `${x.proxyUrl.replace(/\/+$/, '')}/v1beta/${p}`, headers: { 'x-device-id': x.deviceId } };
  return null;
}

/** The proxy's own daily limit (not Gemini's per-model quota): retrying another model won't help. */
export function proxyLimitInfo(status: number, body: string): { scope: 'device' | 'global'; retryAfterSec: number } | null {
  if (status !== 429) return null;
  try {
    const e = JSON.parse(body)?.error;
    if (e?.reason === 'GRABBIT_LIMIT') return { scope: e.scope === 'global' ? 'global' : 'device', retryAfterSec: Number(e.retryAfterSec) || 3600 };
  } catch {}
  return null;
}

/** RFC4122 v4-ish random ID (no crypto dependency needed; it only has to be unique, not secret). */
export function newDeviceId(rand: () => number = Math.random): string {
  const h = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16));
  h[12] = '4'; h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
