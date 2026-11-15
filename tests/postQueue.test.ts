import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPostQueue } from '../src/core/postQueue';

const deferred = () => Promise.withResolvers<void>();

test('a newly shared post jumps the backlog and its caller need only wait for that post', async () => {
  const ids = Array.from({ length: 25 }, (_, i) => i + 1);
  const seen: number[] = [];
  const started = deferred();
  const releaseFirst = deferred();
  const releaseBacklog = deferred();
  const run = createPostQueue(async (id) => {
    const i = id === undefined ? 0 : ids.indexOf(id);
    return i < 0 ? undefined : ids.splice(i, 1)[0];
  }, async (id) => {
    seen.push(id);
    if (id === 1) { started.resolve(); await releaseFirst.promise; }
    if (id === 2) await releaseBacklog.promise;
  });

  const full = run();
  await started.promise;
  const shared = run(25);
  releaseFirst.resolve();
  await shared;
  assert.deepEqual(seen.slice(0, 2), [1, 25]);
  releaseBacklog.resolve();
  await full;
  assert.deepEqual(seen, [1, 25, ...Array.from({ length: 23 }, (_, i) => i + 2)]);
});

test('a general wake-up during a targeted run still drains pending posts', async () => {
  const ids = [1, 2, 3];
  const seen: number[] = [];
  const started = deferred();
  const release = deferred();
  const run = createPostQueue(async (id) => {
    const i = id === undefined ? 0 : ids.indexOf(id);
    return i < 0 ? undefined : ids.splice(i, 1)[0];
  }, async (id) => {
    seen.push(id);
    if (id === 3) { started.resolve(); await release.promise; }
  });
  const targeted = run(3);
  await started.promise;
  const full = run();
  release.resolve();
  await Promise.all([targeted, full]);
  assert.deepEqual(seen, [3, 1, 2]);
});
