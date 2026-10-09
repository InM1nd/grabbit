import { useEffect, useState } from 'react';
import * as db from './db';

export type ThemePref = 'system' | 'light' | 'dark';
export type AiLang = 'ru' | 'en' | 'orig';

export interface Settings {
  theme: ThemePref;
  aiEnabled: boolean;
  aiVision: boolean;      // send preview image to Gemini when the caption is weak
  aiLang: AiLang;
  defaultBoardId: number | null; // null = AI decides
  returnDelay: number;    // seconds after share; 0 = instantly, -1 = stay in app
  remOn: boolean;
  remHour: number;        // 0..23
  remEveryDays: number;   // min gap between reminders
  remAgeDays: number;     // remind about saves older than N days
  igConnected: boolean;
  igUserId: string | null;
}

export const DEFAULTS: Settings = {
  theme: 'system', aiEnabled: true, aiVision: true, aiLang: 'ru', defaultBoardId: null,
  returnDelay: 2, remOn: true, remHour: 19, remEveryDays: 2, remAgeDays: 7,
  igConnected: false, igUserId: null,
};

let cache: Settings = { ...DEFAULTS };
let loaded = false;
const listeners = new Set<(s: Settings) => void>();

export async function loadSettings(): Promise<Settings> {
  if (loaded) return cache;
  try {
    const raw = await db.getSetting('prefs');
    if (raw) cache = { ...DEFAULTS, ...JSON.parse(raw) };
    // migrate v1.0 reminders switch
    const old = await db.getSetting('reminders');
    if (old === 'off' && !raw) cache.remOn = false;
  } catch {}
  loaded = true;
  listeners.forEach((l) => l(cache));
  return cache;
}

export function getSettings(): Settings { return cache; }

export async function updateSettings(patch: Partial<Settings>) {
  cache = { ...cache, ...patch };
  listeners.forEach((l) => l(cache));
  await db.setSetting('prefs', JSON.stringify(cache));
}

export function useSettings(): Settings {
  const [s, setS] = useState(cache);
  useEffect(() => {
    listeners.add(setS);
    loadSettings().then(setS);
    return () => { listeners.delete(setS); };
  }, []);
  return s;
}
