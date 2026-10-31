import type { ExpoConfig } from 'expo/config';

// Personal app: the Gemini key is read from the build machine's env and baked into the bundle.
// Release builds route AI through the Grabbit proxy (server/); the Gemini key is then NOT baked in.
const aiProxyUrl = (process.env.GRABBIT_AI_PROXY_URL || '').trim();
const geminiApiKey = aiProxyUrl ? '' : (process.env.GEMINI_API_KEY || '').trim();
// In-app updates (optional): a READ-ONLY fine-grained token for the private repo, or a public manifest URL.
// Never put the push token here.
const updateToken = (process.env.PINBOX_UPDATE_TOKEN || '').trim();
// Sentry DSN (public-by-design, crash reports only): injected from the build env, never committed.
const sentryDsn = (process.env.GRABBIT_SENTRY_DSN || '').trim();
const updateManifestUrl = (process.env.PINBOX_UPDATE_MANIFEST_URL || '').trim();

const config: ExpoConfig = {
  name: 'Grabbit',
  slug: 'polka',
  scheme: 'pinbox',
  version: '1.10.4',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#FFFFFF',
  android: {
    package: 'com.zabolotny.polka',
    versionCode: 23,
    adaptiveIcon: {
      backgroundColor: '#F8483E',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['android.permission.POST_NOTIFICATIONS', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.REQUEST_INSTALL_PACKAGES'],
    blockedPermissions: [
      'android.permission.VIBRATE', // haptic() uses performHapticFeedback, which needs no permission
      'android.permission.RECORD_AUDIO',
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'com.google.android.c2dm.permission.RECEIVE',
      'com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE',
      'com.sec.android.provider.badge.permission.READ',
      'com.sec.android.provider.badge.permission.WRITE',
      'com.htc.launcher.permission.READ_SETTINGS',
      'com.htc.launcher.permission.UPDATE_SHORTCUT',
      'com.sonyericsson.home.permission.BROADCAST_BADGE',
      'com.sonymobile.home.permission.PROVIDER_INSERT_BADGE',
      'com.anddoes.launcher.permission.UPDATE_COUNT',
      'com.majeur.launcher.permission.UPDATE_BADGE',
      'com.huawei.android.launcher.permission.CHANGE_BADGE',
      'com.huawei.android.launcher.permission.READ_SETTINGS',
      'com.huawei.android.launcher.permission.WRITE_SETTINGS',
      'android.permission.READ_APP_BADGE',
      'com.oppo.launcher.permission.READ_SETTINGS',
      'com.oppo.launcher.permission.WRITE_SETTINGS',
      'me.everything.badger.permission.BADGE_COUNT_READ',
      'me.everything.badger.permission.BADGE_COUNT_WRITE',
    ],
    predictiveBackGestureEnabled: false,
    softwareKeyboardLayoutMode: 'resize',
  },
  plugins: [
    [
      'expo-share-intent',
      {
        androidIntentFilters: ['text/*', 'image/*'],
        disableIOS: true,
      },
    ],
    'expo-sqlite',
    'expo-secure-store',
    'expo-image',
    [
      'expo-splash-screen',
      { image: './assets/splash-icon.png', imageWidth: 120, resizeMode: 'contain', backgroundColor: '#FFFFFF', dark: { backgroundColor: '#0B0B0D' } },
    ],
    [
      'expo-notifications',
      { icon: './assets/notification-icon.png', color: '#F8483E', defaultChannel: 'reminders' },
    ],
  ],
  extra: { aiProxyUrl, geminiApiKey, updateRepo: 'InM1nd/grabbit', updateToken, updateManifestUrl, sentryDsn },
};

export default config;
