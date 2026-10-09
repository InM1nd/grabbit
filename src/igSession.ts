/**
 * Bridge between the processing queue (plain async code) and the hidden WebView
 * that is mounted in the app root and carries the user's Instagram session.
 */
import type { IgRawPage } from './core/igExtract';

type Loader = (url: string) => Promise<IgRawPage>;
let loader: Loader | null = null;
let chain: Promise<unknown> = Promise.resolve();

export function registerIgLoader(fn: Loader | null) { loader = fn; }
export function igLoaderReady() { return !!loader; }

/** Load an Instagram post in the hidden WebView (one at a time) and return what the page exposed. */
export function loadInstagramPage(url: string, timeoutMs = 25000): Promise<IgRawPage> {
  const run = async (): Promise<IgRawPage> => {
    if (!loader) throw new Error('webview-not-ready');
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        loader(url),
        new Promise<IgRawPage>((_, rej) => { t = setTimeout(() => rej(new Error('webview-timeout')), timeoutMs); }),
      ]);
    } finally { if (t) clearTimeout(t); }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}
