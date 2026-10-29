import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as db from './db';
import { newDeviceId, type GeminiAuthObj } from './core/gemini';

const extra = (Constants.expoConfig?.extra as any) || {};
const PROXY_URL: string = extra.aiProxyUrl || '';
/** Legacy/dev builds can still bake a key (only when no proxy URL is configured). */
const BUILD_KEY: string = PROXY_URL ? '' : extra.geminiApiKey || '';
const KEY_ITEM = 'gemini_user_key';

let userKey: string | null = null;
let deviceId: string | null = null;
let loaded: Promise<void> | null = null;

async function load() {
  try { userKey = (await SecureStore.getItemAsync(KEY_ITEM)) || null; } catch { userKey = null; }
  let id = await db.getSetting('device_id');
  if (!id) { id = newDeviceId(); await db.setSetting('device_id', id); }
  deviceId = id;
}
export function ensureAiAuth() { return (loaded ??= load().catch(() => { loaded = null; })); }

export async function getGeminiAuth(): Promise<GeminiAuthObj> {
  await ensureAiAuth();
  return { key: userKey || BUILD_KEY || undefined, proxyUrl: PROXY_URL || undefined, deviceId: deviceId || undefined };
}

export type AiMode = 'own' | 'proxy' | 'build' | 'none';
export function aiMode(): AiMode {
  if (userKey) return 'own';
  if (BUILD_KEY) return 'build';
  return PROXY_URL ? 'proxy' : 'none';
}
export const hasUserKey = () => !!userKey;

export async function setUserKey(key: string | null) {
  const k = key?.trim() || null;
  if (k) await SecureStore.setItemAsync(KEY_ITEM, k);
  else await SecureStore.deleteItemAsync(KEY_ITEM);
  userKey = k;
}
