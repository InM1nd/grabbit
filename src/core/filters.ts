import type { PostMark } from './marks';
import type { Platform } from './types';

/** Feed filter chosen in the «Фильтры» sheet. Empty arrays mean "no restriction". */
export type SourceKey = 'instagram' | 'tiktok' | 'youtube' | 'x' | 'shot' | 'other';
export type SortKey = 'new' | 'old';
export interface FeedFilter { marks: PostMark[]; boards: number[]; sources: SourceKey[]; sort: SortKey }
export const DEFAULT_FILTER: FeedFilter = { marks: [], boards: [], sources: [], sort: 'new' };
export const SOURCE_ORDER: SourceKey[] = ['instagram', 'tiktok', 'youtube', 'x', 'shot', 'other'];

interface FilterablePost { platform: Platform; shot?: boolean; mark: PostMark | null; boardId: number | null; createdAt: number }

/** Every source a post counts as: its platform bucket, plus «screenshot» when one was attached. */
export function sourcesOf(p: Pick<FilterablePost, 'platform' | 'shot'>): SourceKey[] {
  const base: SourceKey = (['instagram', 'tiktok', 'youtube', 'x'] as const).includes(p.platform as any) ? (p.platform as SourceKey) : 'other';
  return p.shot ? [base, 'shot'] : [base];
}

/** Sources that actually occur among the posts, in display order. */
export function presentSources(posts: Pick<FilterablePost, 'platform' | 'shot'>[]): SourceKey[] {
  const s = new Set<SourceKey>();
  for (const p of posts) for (const k of sourcesOf(p)) s.add(k);
  return SOURCE_ORDER.filter((k) => s.has(k));
}

/** No marks selected keeps the old default: everything except «Неважно». */
export function matchesFilter(p: FilterablePost, f: FeedFilter): boolean {
  if (f.marks.length ? !(p.mark && f.marks.includes(p.mark)) : p.mark === 'skip') return false;
  if (f.boards.length && (p.boardId == null || !f.boards.includes(p.boardId))) return false;
  if (f.sources.length && !sourcesOf(p).some((k) => f.sources.includes(k))) return false;
  return true;
}

export function applyFilter<T extends FilterablePost>(posts: T[], f: FeedFilter, keepOrder = false): T[] {
  const out = posts.filter((p) => matchesFilter(p, f));
  if (keepOrder) return out;
  return out.sort((a, b) => (f.sort === 'old' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
}

/** Badge number: how many filter groups differ from the default. */
export function activeCount(f: FeedFilter): number {
  return f.marks.length + f.boards.length + f.sources.length + (f.sort !== 'new' ? 1 : 0);
}

export function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}
