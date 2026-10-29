// Pure helpers for in-app updates (testable in node).

export interface UpdateInfo {
  version: string;      // "1.2.0"
  notes: string;
  apkUrl: string;       // where to download
  apkName: string;
  size: number | null;
  needsAuth: boolean;   // apkUrl is a GitHub API asset url that needs the token + Accept: octet-stream
  pageUrl: string | null;
}

/** "v1.2.0" / "1.2" / "Grabbit 1.10.3-beta" → [1,2,0] */
export function parseVersion(v: string): number[] {
  const m = String(v || '').match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return [0, 0, 0];
  return [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
}

/** >0 if a is newer than b. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** GitHub `releases/latest` JSON → UpdateInfo (or null if no APK asset). */
export function fromGithubRelease(rel: any, viaApi: boolean): UpdateInfo | null {
  if (!rel || typeof rel !== 'object' || !rel.tag_name) return null;
  const assets: any[] = Array.isArray(rel.assets) ? rel.assets : [];
  const apk = assets.find((a) => /\.apk$/i.test(a?.name || ''));
  if (!apk) return null;
  return {
    version: String(rel.tag_name).replace(/^v/i, ''),
    notes: String(rel.body || '').trim(),
    apkUrl: viaApi ? apk.url : apk.browser_download_url,
    apkName: apk.name,
    size: typeof apk.size === 'number' ? apk.size : null,
    needsAuth: viaApi,
    pageUrl: rel.html_url || null,
  };
}

/** Public manifest: {"version":"1.2.0","apkUrl":"https://…/Grabbit-v1.2.0.apk","notes":"…","size":123} */
export function fromManifest(m: any): UpdateInfo | null {
  if (!m || typeof m !== 'object' || !m.version || !/^https:\/\//.test(m.apkUrl || '')) return null;
  return {
    version: String(m.version).replace(/^v/i, ''),
    notes: String(m.notes || '').trim(),
    apkUrl: m.apkUrl,
    apkName: String(m.apkUrl).split('/').pop() || 'Grabbit.apk',
    size: typeof m.size === 'number' ? m.size : null,
    needsAuth: false,
    pageUrl: m.pageUrl || null,
  };
}

export type UpdateSource =
  | { kind: 'manifest'; url: string }
  | { kind: 'github-token'; repo: string; token: string }
  | { kind: 'github-public'; repo: string };

export function pickSource(extra: { updateManifestUrl?: string; updateToken?: string; updateRepo?: string }): UpdateSource {
  const repo = extra.updateRepo || 'InM1nd/polka';
  if (extra.updateManifestUrl) return { kind: 'manifest', url: extra.updateManifestUrl };
  if (extra.updateToken) return { kind: 'github-token', repo, token: extra.updateToken };
  return { kind: 'github-public', repo };
}

export class UpdateError extends Error {
  constructor(public code: 'not-configured' | 'network' | 'no-apk' | 'http', message?: string) { super(message || code); }
}

/** Check the configured source. fetchImpl is injectable for tests. */
export async function fetchLatest(src: UpdateSource, fetchImpl: typeof fetch = fetch): Promise<UpdateInfo> {
  let res: Response;
  try {
    if (src.kind === 'manifest') {
      res = await fetchImpl(src.url + (src.url.includes('?') ? '&' : '?') + 't=' + Date.now(), { headers: { Accept: 'application/json' } });
    } else {
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      if (src.kind === 'github-token') headers.Authorization = `Bearer ${src.token}`;
      res = await fetchImpl(`https://api.github.com/repos/${src.repo}/releases/latest`, { headers });
    }
  } catch (e: any) {
    throw new UpdateError('network', String(e?.message || e));
  }
  if (!res.ok) {
    // private repo without a token answers 404
    if (src.kind === 'github-public' && (res.status === 404 || res.status === 403)) throw new UpdateError('not-configured');
    throw new UpdateError('http', `HTTP ${res.status}`);
  }
  const json = await res.json();
  const info = src.kind === 'manifest' ? fromManifest(json) : fromGithubRelease(json, src.kind === 'github-token');
  if (!info) throw new UpdateError('no-apk');
  return info;
}
