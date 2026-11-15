import type { Metadata } from './types';

export type SummarySource = 'caption' | 'share' | 'note' | 'cover' | 'screenshot' | 'title';
export type DetailSource = 'article' | 'transcript';

export function summarySources(input: { meta: Metadata; sharedText?: string; note?: string; image?: unknown; shot?: boolean }): SummarySource[] {
  const sources: SummarySource[] = [];
  if (input.meta.description?.trim()) sources.push('caption');
  if (input.sharedText?.trim()) sources.push('share');
  if (input.note?.trim()) sources.push('note');
  if (input.image) sources.push(input.shot ? 'screenshot' : 'cover');
  if (input.meta.title?.trim() && !input.meta.blocked && !input.meta.unavailable) sources.push('title');
  return sources;
}

export function readSummarySources(raw: unknown): SummarySource[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const known: SummarySource[] = ['caption', 'share', 'note', 'cover', 'screenshot', 'title'];
  return [...new Set(raw.filter((item): item is SummarySource => known.includes(item)))];
}
