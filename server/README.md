# Grabbit AI proxy

Tiny Vercel function between the app and Gemini. The Gemini key lives only here (env `GEMINI_API_KEY`).

- `GET  /v1beta/models` — model list (free)
- `POST /v1beta/models/<gemini-…>:generateContent` — post analysis (counts toward the daily limit)
- `POST /v1beta/models/<gemini-embedding…>:batchEmbedContents` — search embeddings (separate limit)

Every request needs `x-device-id` (anonymous ID the app makes on first launch).
Over the limit → `429` with `error.reason = "GRABBIT_LIMIT"`, `scope` (`device`/`global`) and `Retry-After`.

Limits (env, per UTC day): `LIMIT_GENERATE_PER_DEVICE` (50), `LIMIT_EMBED_PER_DEVICE` (100), `LIMIT_GLOBAL_PER_DAY` (3000).

Counters: Upstash Redis if `UPSTASH_REDIS_REST_URL`/`_TOKEN` (or `KV_REST_API_*`) are set — recommended,
exact and shared. Otherwise Vercel Runtime Cache (per region, best effort).

Deploy: `cd server && vercel deploy --prod`, then set `GEMINI_API_KEY` in the project env.
The app build takes the URL from `GRABBIT_AI_PROXY_URL`.
