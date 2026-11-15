import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postsInBoard } from '../src/core/boardView';

test('a board and the Inbox show their own posts independently of feed marks', () => {
  const unassigned = { boardId: null, mark: null };
  const saved = { boardId: 4, mark: 'skip' };
  const other = { boardId: 7, mark: 'try' };
  const posts = [unassigned, saved, other];
  assert.deepEqual(postsInBoard(posts, 'inbox'), [unassigned]);
  assert.deepEqual(postsInBoard(posts, 4), [saved]);
  assert.deepEqual(postsInBoard(posts, 7), [other]);
  assert.deepEqual(postsInBoard(posts, 9), []);
});

test('board overview counts posts once per topic and ignores skipped and unfinished topic data', async () => {
  const { summarizeBoard } = await import('../src/core/boardView');
  const posts = [
    { id: 1, tags: ['#React', 'react', 'DOM'], openedAt: null, mark: 'try', status: 'done' },
    { id: 2, tags: ['react'], openedAt: 123, mark: null, status: 'done' },
    { id: 3, tags: ['unread'], openedAt: null, mark: 'skip', status: 'done' },
    { id: 4, tags: ['guess'], openedAt: null, mark: null, status: 'pending' },
  ];
  const view = summarizeBoard(posts);
  assert.deepEqual(view.topics.map(({ key, count }) => [key, count]), [['react', 2], ['dom', 1]]);
  assert.equal(view.unread, 2);
  assert.equal(view.toTry, 1);
  assert.deepEqual(view.samples.map(post => post.id), [1, 2]);
});
