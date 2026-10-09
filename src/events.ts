type Fn = () => void;
const listeners = new Set<Fn>();
export function onDataChanged(fn: Fn): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function emitDataChanged() {
  listeners.forEach((f) => { try { f(); } catch {} });
}
