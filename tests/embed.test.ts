import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveCut, cosine, embedText, normalize, packVec, rankByVector, similarPosts, unpackVec } from '../src/core/embed';
import { markAllowed } from '../src/core/marks';

test('cosine / normalize / pack roundtrip', () => {
  assert.equal(Math.round(cosine([1, 0], [1, 0]) * 1000), 1000);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([1], [1, 2]), 0);
  const n = normalize([3, 4]);
  assert.deepEqual(n, [0.6, 0.8]);
  assert.deepEqual(unpackVec(packVec([0.123456, -0.5])), [0.1235, -0.5]);
  assert.equal(unpackVec('[]'), null);
  assert.equal(unpackVec('garbage'), null);
});

test('embedText skips empty fields, prefers AI title', () => {
  assert.equal(embedText({}), '');
  const s = embedText({ aiTitle: 'A', title: 'B', summary: 'S', tags: ['x', 'y'], board: 'Board' });
  assert.equal(s, 'A\nS\n#x #y\nBoard');
});

const P = (id: number, embedding: number[] | null, tags: string[] = [], boardId: number | null = null) => ({ id, embedding, tags, boardId });

test('rankByVector orders by cosine and drops low scores / missing vectors', () => {
  const posts = [P(1, [1, 0]), P(2, [0.95, 0.31]), P(3, [0, 1]), P(4, null)];
  assert.deepEqual(rankByVector([1, 0], posts).map((x) => x.post.id), [1, 2]);
  // a stand-out match in a crowd of mediocre ones
  const crowd = [P(10, [0.9, 0.44]), ...Array.from({ length: 8 }, (_, i) => P(i + 20, [0.6, 0.8]))];
  assert.deepEqual(rankByVector([1, 0], crowd).map((x) => x.post.id), [10]);
});

test('similarPosts: embeddings first, then shared tags, never itself', () => {
  const target = P(1, [1, 0], ['ai', 'video'], 7);
  const all = [target, P(2, [0.9, 0.1]), P(3, [0, 1], ['video']), P(4, null, ['ai', 'video']), P(5, null, ['cooking'], 7), P(6, null, [])];
  assert.deepEqual(similarPosts(target, all, 6).map((p) => p.id), [2, 4, 3]);
  // no embedding on target → tag fallback only
  assert.deepEqual(similarPosts({ ...target, embedding: null }, all, 6).map((p) => p.id), [4, 3]);
});

test('mark filter: Неважно hidden by default', () => {
  assert.equal(markAllowed(null), true);
  assert.equal(markAllowed('try'), true);
  assert.equal(markAllowed('skip'), false);
  assert.equal(markAllowed('skip', 'all'), true);
  assert.equal(markAllowed('skip', 'skip'), true);
  assert.equal(markAllowed('try', 'done'), false);
});

test('adaptiveCut honours floor and gap', () => {
  assert.equal(adaptiveCut([], 1, 0.1, 0.5), Infinity);
  assert.equal(adaptiveCut([0.9, 0.3], 1, 0.1, 0.5), 0.8);
  assert.equal(adaptiveCut([0.4, 0.3], 1, 0.1, 0.5), 0.5);
});
