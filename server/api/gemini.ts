import { Bad, buildEmbedBody, buildGenerateBody, clientIp, EMBED_MODEL, GENERATE_MODELS, MAX_BODY_BYTES, parseEmbed, parseGenerate } from '../lib/validate.js';
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

/** Read at most `max` bytes; null if larger. */
async function readCapped(req: Request, max: number): Promise<string | null> {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > max) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const err = (status: number, message: string) => json(status, { error: { code: status, message } });

// Post content is never logged: only status codes and error classes leave this function.
async function handle(req: Request): Promise<Response> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return err(500, 'Proxy is not configured');
  const u = new URL(req.url);
  const path = u.searchParams.get('path') || u.pathname.replace(/^\/api\/gemini\/?/, '');
  if (path === 'health') return json(200, { ok: true });
  const route = parseRoute(req.method, path);
  if (!route) return err(404, 'Unknown endpoint');
  const device = req.headers.get('x-device-id') || '';
  if (!DEVICE_RE.test(device)) return err(400, 'Missing x-device-id');
  // Model list is answered locally: only the allowlisted models exist for clients.
  if (route.kind === 'models') return json(200, { models: [...GENERATE_MODELS, EMBED_MODEL].map((m) => ({ name: `models/${m}` })) });
  const model = route.upstreamPath.slice('models/'.length).split(':')[0];
  const raw = await readCapped(req, MAX_BODY_BYTES);
  if (raw == null) return err(413, 'Request too large');
  let upstreamBody: string;
  try {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Bad(400, 'Invalid JSON'); }
    upstreamBody = JSON.stringify(route.kind === 'generate' ? buildGenerateBody(parseGenerate(model, parsed)) : buildEmbedBody(parseEmbed(model, parsed)));
  } catch (e) {
    if (e instanceof Bad) return err(e.status, e.message);
    return err(400, 'Invalid request');
  }
  const v = await checkLimit(store, device, route.kind, readLimits(process.env), Date.now(), clientIp(req.headers));
  if (!v.ok) return json(429, limitBody(v), { 'retry-after': String(v.retryAfter) });
  let r: Response;
  try {
    r = await fetch(UPSTREAM + route.upstreamPath, {
      method: 'POST', body: upstreamBody, signal: AbortSignal.timeout(25_000),
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    });
  } catch {
    return err(504, 'Upstream timeout');
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (v.limit) headers['x-grabbit-remaining'] = String(Math.max(0, v.limit - v.used));
  return new Response(await r.text(), { status: r.status, headers });
}

export const GET = handle;
export const POST = handle;
