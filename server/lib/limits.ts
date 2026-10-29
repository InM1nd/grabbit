/** Pure proxy logic (no Vercel deps) — unit-tested from ../tests/proxyServer.test.ts. */

export const DEVICE_RE = /^[a-zA-Z0-9-]{16,64}$/;
export const MODEL_RE = /^gemini-[a-z0-9.-]{1,48}$/;

export type Kind = 'generate' | 'embed' | 'models';
export interface Route { kind: Kind; upstreamPath: string }

/** Only the three Gemini calls the app makes are forwarded. */
export function parseRoute(method: string, path: string): Route | null {
  const p = path.replace(/^\/+/, '').replace(/^v1beta\//, '');
  if (method === 'GET' && p === 'models') return { kind: 'models', upstreamPath: 'models?pageSize=200' };
  const m = p.match(/^models\/([^:/]+):(generateContent|batchEmbedContents)$/);
  if (method !== 'POST' || !m || !MODEL_RE.test(m[1])) return null;
  if (m[2] === 'batchEmbedContents' && !m[1].includes('embedding')) return null;
  if (m[2] === 'generateContent' && m[1].includes('embedding')) return null;
  return { kind: m[2] === 'generateContent' ? 'generate' : 'embed', upstreamPath: `models/${m[1]}:${m[2]}` };
}

export interface Limits { generatePerDevice: number; embedPerDevice: number; globalPerDay: number }
export const DEFAULT_LIMITS: Limits = { generatePerDevice: 50, embedPerDevice: 100, globalPerDay: 3000 };

export function readLimits(env: Record<string, string | undefined>): Limits {
  const n = (v: string | undefined, d: number) => (v && Number(v) > 0 ? Number(v) : d);
  return {
    generatePerDevice: n(env.LIMIT_GENERATE_PER_DEVICE, DEFAULT_LIMITS.generatePerDevice),
    embedPerDevice: n(env.LIMIT_EMBED_PER_DEVICE, DEFAULT_LIMITS.embedPerDevice),
    globalPerDay: n(env.LIMIT_GLOBAL_PER_DAY, DEFAULT_LIMITS.globalPerDay),
  };
}

/** Counter store: incr returns the new value; keys expire after ttl seconds. */
export interface Store { incr(key: string, ttlSec: number): Promise<number> }

export class MemoryStore implements Store {
  private m = new Map<string, { v: number; exp: number }>();
  constructor(private now: () => number = Date.now) {}
  async incr(key: string, ttlSec: number) {
    const cur = this.m.get(key);
    const live = cur && cur.exp > this.now() ? cur : { v: 0, exp: this.now() + ttlSec * 1000 };
    live.v++;
    this.m.set(key, live);
    return live.v;
  }
}

export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
/** Seconds until the next UTC midnight. */
export const secondsToReset = (now: number) => Math.max(1, Math.ceil((Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1) - now) / 1000));

export type Verdict =
  | { ok: true; used: number; limit: number }
  | { ok: false; scope: 'device' | 'global'; used: number; limit: number; retryAfter: number };

/** Count the request; 'models' (list) is free. Over-limit requests still count, which is fine. */
export async function checkLimit(store: Store, deviceId: string, kind: Kind, limits: Limits, now = Date.now()): Promise<Verdict> {
  if (kind === 'models') return { ok: true, used: 0, limit: 0 };
  const day = dayKey(now);
  const ttl = secondsToReset(now) + 60;
  const retryAfter = secondsToReset(now);
  const limit = kind === 'generate' ? limits.generatePerDevice : limits.embedPerDevice;
  const used = await store.incr(`d:${day}:${kind}:${deviceId}`, ttl);
  if (used > limit) return { ok: false, scope: 'device', used, limit, retryAfter };
  if (kind === 'generate') {
    const g = await store.incr(`g:${day}`, ttl);
    if (g > limits.globalPerDay) return { ok: false, scope: 'global', used: g, limit: limits.globalPerDay, retryAfter };
  }
  return { ok: true, used, limit };
}

export function limitBody(v: Extract<Verdict, { ok: false }>) {
  return {
    error: {
      code: 429, status: 'RESOURCE_EXHAUSTED', reason: 'GRABBIT_LIMIT', scope: v.scope, limit: v.limit, retryAfterSec: v.retryAfter,
      message: v.scope === 'device' ? `Daily AI limit reached (${v.limit}/day)` : 'Daily AI limit of the free server reached',
    },
  };
}
