/** User's own mark: try it / done / not important. null = none. */
export type PostMark = 'try' | 'done' | 'skip';
/** Feed filter. 'default' = everything except «Неважно» (hidden unless asked for). */
export type MarkFilter = 'default' | 'all' | PostMark;

export function markAllowed(mark: PostMark | null, f: MarkFilter = 'default'): boolean {
  if (f === 'all') return true;
  if (f === 'default') return mark !== 'skip';
  return mark === f;
}
