import { requireOptionalNativeModule } from 'expo-modules-core';

const Native = requireOptionalNativeModule<{ clearAll(): Promise<boolean> }>('GrabbitCookies');

/** Wipe the app's WebView cookies + web storage (Instagram session). Returns false if unavailable. */
export async function clearWebSession(): Promise<boolean> {
  if (!Native) return false;
  try { return await Native.clearAll(); } catch { return false; }
}
