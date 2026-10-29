# Grabbit AI proxy

Tiny Vercel function between the app and Gemini. The Gemini key lives only here (env `GEMINI_API_KEY`).

- `GET  /v1beta/models` — model list (free)
- `POST /v1beta/models/<gemini-…>:generateContent` — post analysis (counts toward the daily limit)
- `POST /v1beta/models/<gemini-embedding…>:batchEmbedContents` — search embeddings (separate limit)

Every request needs `x-device-id` (anonymous ID the app makes on first launch).
Over the limit → `429` with `error.reason = "GRABBIT_LIMIT"`, `scope` (`device`/`global`) and `Retry-After`.

Limits (env, per UTC day unless noted): `LIMIT_GENERATE_PER_DEVICE` (50), `LIMIT_EMBED_PER_DEVICE` (100),
`LIMIT_IP_PER_DAY` (200), `LIMIT_IP_PER_MINUTE` (20), `LIMIT_GLOBAL_PER_DAY` (3000 analyses), `LIMIT_GLOBAL_EMBED_PER_DAY` (10000).

Validation (`lib/validate.ts`): only the app's models are allowed: the 4 Gemini flash/lite models for analysis and
`gemini-embedding-001` for embeddings; anything else gets a 400. The upstream body is rebuilt on the server, so
generationConfig, the response schema, tools and systemInstruction are fixed there and cannot come from the client.
Limits: one user prompt of at most 12k chars and one jpeg/png/webp image of at most 1.5 MB (checked by magic bytes);
at most 100 embedding texts of at most 8k chars each, always 256 dims; request body at most 2.6 MB (else 413).
Upstream timeout is 25 s (then 504). `GET /models` is answered locally with the allowlist. Request content is never logged.

Counters: Upstash Redis if `UPSTASH_REDIS_REST_URL`/`_TOKEN` (or `KV_REST_API_*`) are set — recommended,
exact and shared. Otherwise Vercel Runtime Cache (per region, best effort).

Deploy: `cd server && vercel deploy --prod`, then set `GEMINI_API_KEY` in the project env.
The app build takes the URL from `GRABBIT_AI_PROXY_URL`.
