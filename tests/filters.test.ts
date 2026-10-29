import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activeCount, applyFilter, DEFAULT_FILTER, matchesFilter, presentSources, sourcesOf, toggle } from '../src/core/filters';

const P = (id: number, o: any = {}) => ({ id, platform: 'instagram', shot: false, mark: null, boardId: null, createdAt: id, ...o });
const posts = [
  P(1), P(2, { mark: 'skip' }), P(3, { mark: 'try', boardId: 5, platform: 'youtube' }),
  P(4, { mark: 'done', boardId: 6, platform: 'github' }), P(5, { platform: 'x', shot: true, boardId: 5 }),
];

test('default filter hides «Неважно» like before and sorts newest first', () => {
  assert.deepEqual(applyFilter(posts, DEFAULT_FILTER).map((p) => p.id), [5, 4, 3, 1]);
  assert.equal(activeCount(DEFAULT_FILTER), 0);
});

test('status is multi-select and can show «Неважно» explicitly', () => {
  const f = { ...DEFAULT_FILTER, marks: ['try', 'skip'] as any };
  assert.deepEqual(applyFilter(posts, f).map((p) => p.id), [3, 2]);
  assert.equal(activeCount(f), 2);
});

test('boards and sources combine with AND across sections, OR within a section', () => {
  const f = { ...DEFAULT_FILTER, boards: [5, 6], sources: ['youtube', 'shot'] as any };
  assert.deepEqual(applyFilter(posts, f).map((p) => p.id), [5, 3]);
  assert.equal(matchesFilter(posts[0], { ...DEFAULT_FILTER, boards: [5] }), false);
});

test('sources: unknown platforms are «other», screenshots count as both', () => {
  assert.deepEqual(sourcesOf({ platform: 'github' as any }), ['other']);
  assert.deepEqual(sourcesOf({ platform: 'x', shot: true }), ['x', 'shot']);
  assert.deepEqual(presentSources(posts as any), ['instagram', 'youtube', 'x', 'shot', 'other']);
});

test('oldest-first sort, keepOrder for semantic ranking, toggle', () => {
  assert.deepEqual(applyFilter(posts, { ...DEFAULT_FILTER, sort: 'old' }).map((p) => p.id), [1, 3, 4, 5]);
  assert.deepEqual(applyFilter([posts[3], posts[0]], DEFAULT_FILTER, true).map((p) => p.id), [4, 1]);
  assert.equal(activeCount({ ...DEFAULT_FILTER, sort: 'old' }), 1);
  assert.deepEqual(toggle([1, 2], 2), [1]);
  assert.deepEqual(toggle([1], 2), [1, 2]);
});
