import { checkLimit, DEVICE_RE, limitBody, MemoryStore, parseRoute, readLimits, type Store } from '../lib/limits.js';

const UPSTREAM = 'https://generativelanguage.googleapis.com/v1beta/';
const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

/** Upstash Redis (REST) when configured, otherwise Vercel Runtime Cache, otherwise per-instance memory. */
function makeStore(): Store {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    return {
      async incr(key, ttl) {
        const r = await fetch(`${url}/pipeline`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify([['INCR', key], ['EXPIRE', key, String(ttl), 'NX']]),
        });
        const j = await r.json();
        return Number(j[0].result);
      },
    };
  }
  const mem = new MemoryStore();
  return {
    async incr(key, ttl) {
      try {
        const { getCache } = await import('@vercel/functions');
        const cache = getCache({ namespace: 'grabbit' });
        const v = (Number(await cache.get(key)) || 0) + 1;
        await cache.set(key, v, { ttl });
        return Math.max(v, await mem.incr(key, ttl));
      } catch {
        return mem.incr(key, ttl);
      }
    },
  };
}
const store = makeStore();

async function handle(req: Request): Promise<Response> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return json(500, { error: { code: 500, message: 'Proxy is not configured' } });
  const u = new URL(req.url);
  const path = u.searchParams.get('path') || u.pathname.replace(/^\/api\/gemini\/?/, '');
  if (path === 'health') return json(200, { ok: true });
  const route = parseRoute(req.method, path);
  if (!route) return json(404, { error: { code: 404, message: 'Unknown endpoint' } });
  const device = req.headers.get('x-device-id') || '';
  if (!DEVICE_RE.test(device)) return json(400, { error: { code: 400, message: 'Missing x-device-id' } });
  const body = req.method === 'POST' ? await req.text() : undefined;
  if (body && body.length > 4_000_000) return json(413, { error: { code: 413, message: 'Request too large' } });
  const v = await checkLimit(store, device, route.kind, readLimits(process.env));
  if (!v.ok) return json(429, limitBody(v), { 'retry-after': String(v.retryAfter) });
  const r = await fetch(UPSTREAM + route.upstreamPath, {
    method: req.method, body,
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
  });
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (v.limit) headers['x-grabbit-remaining'] = String(Math.max(0, v.limit - v.used));
  return new Response(await r.text(), { status: r.status, headers });
}

export const GET = handle;
export const POST = handle;
