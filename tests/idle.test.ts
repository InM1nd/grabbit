import { test } from 'node:test';
import assert from 'node:assert';
import { idleWithin } from '../src/core/idle';

test('idle resolves when interactions finish', async () => {
  const t0 = Date.now();
  await idleWithin((cb) => setTimeout(cb, 5), 1000);
  assert.ok(Date.now() - t0 < 500);
});
test('idle does not hang when interactions never finish', async () => {
  const t0 = Date.now();
  await idleWithin(() => {}, 100);
  assert.ok(Date.now() - t0 < 500);
});
test('idle survives a throwing scheduler', async () => {
  await idleWithin(() => { throw new Error('x'); }, 100);
});
