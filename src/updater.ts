import Constants from 'expo-constants';
import * as FS from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { compareVersions, fetchLatest, pickSource, UpdateError, type UpdateInfo } from './core/release';
import { getSettings, updateSettings } from './settings';

export type { UpdateInfo };
export { UpdateError };

export const currentVersion = (): string => Constants.expoConfig?.version || '0.0.0';
const extra = (): any => Constants.expoConfig?.extra || {};
export const releasesPage = (): string => `https://github.com/${extra().updateRepo || 'InM1nd/polka'}/releases/latest`;
export const updateSourceKind = () => pickSource(extra()).kind;

export interface CheckResult { info: UpdateInfo; newer: boolean }

export async function checkForUpdate(): Promise<CheckResult> {
  const info = await fetchLatest(pickSource(extra()));
  await updateSettings({ updLastCheck: Date.now() });
  return { info, newer: compareVersions(info.version, currentVersion()) > 0 };
}

/** Silent check on launch, at most once per 12 h. Returns info only when a newer, not-skipped version exists. */
export async function autoCheck(): Promise<UpdateInfo | null> {
  const s = getSettings();
  if (!s.updAuto || Date.now() - (s.updLastCheck || 0) < 12 * 3600_000) return null;
  try {
    const r = await checkForUpdate();
    if (r.newer && r.info.version !== s.updSkipVersion) return r.info;
  } catch {}
  return null;
}

let busy = false;

/** Download the APK into the cache dir and hand it to the system installer. */
export async function downloadAndInstall(info: UpdateInfo, onProgress?: (fraction: number) => void): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const dest = `${FS.cacheDirectory}updates/`;
    await FS.makeDirectoryAsync(dest, { intermediates: true }).catch(() => {});
    const file = `${dest}Grabbit-v${info.version}.apk`;
    await FS.deleteAsync(file, { idempotent: true }).catch(() => {});
    const headers: Record<string, string> = {};
    if (info.needsAuth) {
      // GitHub API asset: redirects to a signed S3 url (OkHttp drops Authorization on cross-host redirect).
      headers.Accept = 'application/octet-stream';
      headers.Authorization = `Bearer ${extra().updateToken}`;
    }
    const task = FS.createDownloadResumable(info.apkUrl, file, { headers }, (p) => {
      const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : info.size || 0;
      if (total > 0) onProgress?.(Math.min(1, p.totalBytesWritten / total));
    });
    const res = await task.downloadAsync();
    if (!res || res.status < 200 || res.status >= 300) throw new UpdateError('http', `HTTP ${res?.status ?? '?'}`);
    const stat = await FS.getInfoAsync(file);
    if (!stat.exists || (stat.size ?? 0) < 1_000_000) throw new UpdateError('http', 'APK damaged');
    const uri = await FS.getContentUriAsync(file);
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: uri,
      type: 'application/vnd.android.package-archive',
      flags: 1 | 0x10000000, // FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK
    });
  } finally {
    busy = false;
  }
}

/** Remove downloaded APKs (called on start after a successful update). */
export async function cleanupUpdates() {
  try { await FS.deleteAsync(`${FS.cacheDirectory}updates/`, { idempotent: true }); } catch {}
}
