/** Strict request validation: the proxy rebuilds every Gemini body itself (audit G-01/G-02). */

export const GENERATE_MODELS = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite'] as const;
export const EMBED_MODEL = 'gemini-embedding-001';
export const MAX_BODY_BYTES = 2_600_000;          // ~1.5 MB image as base64 + prompt
export const MAX_IMAGE_BYTES = 1_500_000;         // decoded
export const MAX_PROMPT_CHARS = 12_000;
export const MAX_EMBED_TEXTS = 100;
export const MAX_EMBED_CHARS = 8_000;
export const EMBED_DIM = 256;
const TASKS = ['RETRIEVAL_DOCUMENT', 'RETRIEVAL_QUERY', 'SEMANTIC_SIMILARITY'];

/** Same schema the app expects back; fixed on the server. */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' }, summary: { type: 'STRING' },
    tags: { type: 'ARRAY', items: { type: 'STRING' } }, board: { type: 'STRING' }, boardEmoji: { type: 'STRING' },
  },
  required: ['title', 'summary', 'tags', 'board'],
};

export class Bad extends Error { constructor(public status: number, msg: string) { super(msg); } }

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const onlyKeys = (o: Record<string, any>, allowed: string[], where: string) => {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new Bad(400, `Field not allowed: ${where}.${k}`);
};

/** jpeg / png / webp by magic bytes; returns the real mime type. */
export function imageMime(b64: string): string | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const h = Buffer.from(b64.slice(0, 24), 'base64');
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg';
  if (h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export interface AnalyzeInput { model: string; prompt: string; image?: { mimeType: string; data: string } }

/**
 * Accepts the 1.8.0 request shape ({contents:[{role,parts:[{text},{inlineData}?]}], generationConfig})
 * but keeps only the prompt text and one checked image. Everything else the client sends
 * (tools, systemInstruction, safetySettings, its own generationConfig) is rejected or ignored.
 */
export function parseGenerate(model: string, body: unknown): AnalyzeInput {
  if (!(GENERATE_MODELS as readonly string[]).includes(model)) throw new Bad(400, 'Model not allowed');
  if (!isObj(body)) throw new Bad(400, 'Body must be a JSON object');
  onlyKeys(body, ['contents', 'generationConfig'], 'body');
  const c = body.contents;
  if (!Array.isArray(c) || c.length !== 1 || !isObj(c[0])) throw new Bad(400, 'contents must have exactly one item');
  onlyKeys(c[0], ['role', 'parts'], 'contents[0]');
  if (c[0].role !== undefined && c[0].role !== 'user') throw new Bad(400, 'role must be user');
  const parts = c[0].parts;
  if (!Array.isArray(parts) || parts.length < 1 || parts.length > 2) throw new Bad(400, 'parts: text and at most one image');
  const [tp, ip] = parts;
  if (!isObj(tp) || typeof tp.text !== 'string' || Object.keys(tp).length !== 1) throw new Bad(400, 'first part must be text');
  const prompt = tp.text.trim();
  if (!prompt) throw new Bad(400, 'Empty text');
  if (prompt.length > MAX_PROMPT_CHARS) throw new Bad(413, 'Text too long');
  let image: AnalyzeInput['image'];
  if (ip !== undefined) {
    const d = isObj(ip) ? (ip.inlineData ?? ip.inline_data) : null;
    if (!isObj(ip) || Object.keys(ip).length !== 1 || !isObj(d) || typeof d.data !== 'string') throw new Bad(400, 'second part must be inlineData');
    if (Math.floor(d.data.length * 3 / 4) > MAX_IMAGE_BYTES) throw new Bad(413, 'Image too large');
    const mime = imageMime(d.data);
    if (!mime) throw new Bad(400, 'Image must be JPEG, PNG or WebP');
    image = { mimeType: mime, data: d.data };
  }
  return { model, prompt, image };
}

/** Gemini body built only from validated fields with fixed, safe generation settings. */
export function buildGenerateBody(i: AnalyzeInput) {
  return {
    contents: [{ role: 'user', parts: [{ text: i.prompt }, ...(i.image ? [{ inlineData: i.image }] : [])] }],
    generationConfig: {
      responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.4, maxOutputTokens: 4096,
      ...(i.model.includes('lite') ? {} : { thinkingConfig: { thinkingLevel: 'low' } }),
    },
  };
}

export interface EmbedInput { task: string; texts: string[] }

/** 1.8.0 shape: {requests:[{model, content:{parts:[{text}]}, taskType, outputDimensionality}]} */
export function parseEmbed(model: string, body: unknown): EmbedInput {
  if (model !== EMBED_MODEL) throw new Bad(400, 'Model not allowed');
  if (!isObj(body)) throw new Bad(400, 'Body must be a JSON object');
  onlyKeys(body, ['requests'], 'body');
  const rq = body.requests;
  if (!Array.isArray(rq) || !rq.length) throw new Bad(400, 'requests required');
  if (rq.length > MAX_EMBED_TEXTS) throw new Bad(413, 'Too many texts');
  let task = '';
  const texts = rq.map((r: any, i: number) => {
    if (!isObj(r)) throw new Bad(400, `requests[${i}] invalid`);
    onlyKeys(r, ['model', 'content', 'taskType', 'outputDimensionality'], `requests[${i}]`);
    if (r.model !== undefined && r.model !== `models/${EMBED_MODEL}`) throw new Bad(400, 'Model not allowed');
    if (!TASKS.includes(r.taskType)) throw new Bad(400, 'taskType not allowed');
    if (task && r.taskType !== task) throw new Bad(400, 'Mixed taskType');
    task = r.taskType;
    const p = isObj(r.content) && Array.isArray(r.content.parts) && r.content.parts.length === 1 ? r.content.parts[0] : null;
    if (!isObj(p) || typeof p.text !== 'string' || Object.keys(p).length !== 1) throw new Bad(400, 'content must be one text part');
    if (p.text.length > MAX_EMBED_CHARS) throw new Bad(413, 'Text too long');
    return p.text;
  });
  return { task, texts };
}

export function buildEmbedBody(e: EmbedInput) {
  return { requests: e.texts.map((text) => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text }] }, taskType: e.task, outputDimensionality: EMBED_DIM })) };
}

/** Client IP as seen by Vercel's edge (first x-forwarded-for hop). */
export function clientIp(h: { get(n: string): string | null }): string {
  const ip = (h.get('x-real-ip') || h.get('x-forwarded-for')?.split(',')[0] || '').trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : 'unknown';
}
