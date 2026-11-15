export type BoardView = number | 'inbox';

export function postsInBoard<T extends { boardId: number | null }>(posts: T[], view: BoardView): T[] {
  return posts.filter((post) => post.boardId === (view === 'inbox' ? null : view));
}

type BoardPost = { tags: string[]; openedAt: number | null; mark: string | null; status: string };

export const topicKey = (tag: string) => tag.trim().replace(/^#/, '').toLowerCase();

export function summarizeBoard<T extends BoardPost>(posts: T[]) {
  const active = posts.filter((post) => post.mark !== 'skip');
  const topics = new Map<string, { key: string; count: number; sample: T }>();
  for (const post of active) {
    if (post.status !== 'done') continue;
    for (const key of new Set(post.tags.map(topicKey).filter(Boolean))) {
      const topic = topics.get(key);
      if (topic) topic.count++;
      else topics.set(key, { key, count: 1, sample: post });
    }
  }
  const top = [...topics.values()].sort((a, b) => b.count - a.count).slice(0, 4);
  const samples = [...new Set([...top.map(topic => topic.sample), ...active.filter(post => post.status === 'done')])].slice(0, 2);
  return { topics: top, samples, unread: active.filter(post => !post.openedAt).length, toTry: active.filter(post => post.mark === 'try').length };
}
