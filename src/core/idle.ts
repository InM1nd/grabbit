/**
 * Wait for `schedule` (e.g. InteractionManager.runAfterInteractions) but never longer than `maxMs`.
 * 1.10.4: a leaked interaction handle (an animation that never reports its end) used to block the
 * whole AI queue forever — posts stayed «в очереди».
 */
export function idleWithin(schedule: (cb: () => void) => void, maxMs = 800): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const t = setTimeout(finish, maxMs);
    try { schedule(() => setTimeout(() => { clearTimeout(t); finish(); }, 16)); } catch { clearTimeout(t); finish(); }
  });
}
