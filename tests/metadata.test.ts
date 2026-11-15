import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchMetadata } from '../src/core/metadata';

test('metadata times out while reading a stalled response body and tries the fallback', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    if (++requests === 1) {
      return {
        ok: true, url: 'https://example.com/post', headers: new Headers(),
        text: () => new Promise<string>((_, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('stalled')), { once: true });
        }),
      };
    }
    return new Response('<meta property="og:title" content="Fallback title">', { headers: { 'content-type': 'text/html' } });
  });

  const result = fetchMetadata('https://example.com/post');
  await Promise.resolve();
  t.mock.timers.tick(9_000);
  assert.equal((await result).title, 'Fallback title');
  assert.equal(requests, 2);
});

test('Instagram does not retry the same Open Graph user agent twice in one pass', async (t) => {
  const agents: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    agents.push(new Headers(init.headers).get('User-Agent')!);
    return new Response('', { status: 403 });
  });

  assert.equal((await fetchMetadata('https://www.instagram.com/p/abc123/')).blocked, true);
  assert.equal(agents.length, 4);
  assert.equal(new Set(agents).size, agents.length);
});
