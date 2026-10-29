import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { IG_INJECT_JS, IG_LOGIN_CHECK_JS, IG_LOGOUT_JS, type IgRawPage } from '../core/igExtract';
import { registerIgLoader } from '../igSession';
import { useColors } from '../theme';
import { t } from '../i18n';

// Same engine & cookie jar for login and the hidden loader (Android CookieManager is app-wide & persistent).
const COMMON: Partial<React.ComponentProps<typeof WebView>> = {
  javaScriptEnabled: true,
  domStorageEnabled: true,
  thirdPartyCookiesEnabled: true,
  sharedCookiesEnabled: true,
  cacheEnabled: true,
  setSupportMultipleWindows: false,
  originWhitelist: ['https://*'],
};

/** Invisible 1×1 WebView that loads Instagram posts with the user's session. Mounted once in App. */
export function HiddenInstagramLoader({ enabled }: { enabled: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const pending = useRef<{ url: string; resolve: (r: IgRawPage) => void } | null>(null);
  const key = useRef(0);

  useEffect(() => {
    if (!enabled) { registerIgLoader(null); return; }
    registerIgLoader((url) => new Promise<IgRawPage>((resolve) => {
      pending.current = { url, resolve };
      key.current++;
      setSrc(url);
    }));
    return () => registerIgLoader(null);
  }, [enabled]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data?.type !== 'ig-page' || !pending.current) return;
      const p = pending.current; pending.current = null;
      p.resolve({ ...data, url: p.url });
      setSrc(null);
    } catch {}
  };

  if (!enabled || !src) return null;
  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        key={key.current}
        {...COMMON}
        source={{ uri: src }}
        injectedJavaScript={IG_INJECT_JS}
        onMessage={onMessage}
        onError={() => { const p = pending.current; pending.current = null; p?.resolve({ url: p.url, error: 'load-error' }); setSrc(null); }}
        style={{ width: 360, height: 640 }}
      />
    </View>
  );
}

interface LoginProps { visible: boolean; mode: 'login' | 'logout'; onClose: () => void; onResult: (loggedIn: boolean, userId: string | null) => void }

/** Visible WebView for logging in to (or out of) Instagram. */
export function InstagramLoginModal({ visible, mode, onClose, onResult }: LoginProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const done = useRef(false);
  const web = useRef<WebView>(null);
  useEffect(() => { if (visible) { done.current = false; setLoading(true); } }, [visible]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const d = JSON.parse(e.nativeEvent.data);
      if (done.current) return;
      if (mode === 'login' && d.type === 'ig-login' && d.loggedIn && !/accounts\/login|challenge|two_factor/.test(d.url)) {
        done.current = true; onResult(true, d.userId);
      }
      if (mode === 'logout' && d.type === 'ig-logout') { done.current = true; onResult(!!d.loggedIn, null); }
    } catch {}
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <View style={[styles.bar, { borderBottomColor: c.line }]}>
          <Pressable onPress={onClose} hitSlop={12} style={{ padding: 8 }}><Ionicons name="close" size={24} color={c.text} /></Pressable>
          <Text style={[styles.title, { color: c.text }]}>{mode === 'login' ? t('Вход в Instagram') : t('Выход из Instagram')}</Text>
          {loading ? <ActivityIndicator color={c.accent} style={{ marginRight: 12 }} /> : <View style={{ width: 40 }} />}
        </View>
        {mode === 'login' && (
          <Text style={[styles.hint, { color: c.sub }]}>
            {t('Логин идёт прямо на instagram.com — Grabbit не видит пароль. Сессия хранится только на телефоне и нужна, чтобы читать посты закрытых аккаунтов, на которые ты подписан.')}
          </Text>
        )}
        {visible && (
          <WebView
            {...COMMON}
            source={{ uri: mode === 'login' ? 'https://www.instagram.com/accounts/login/' : 'https://www.instagram.com/' }}
            injectedJavaScript={mode === 'login' ? IG_LOGIN_CHECK_JS : IG_LOGOUT_JS}
            onMessage={onMessage}
            ref={web}
            onLoadEnd={() => { setLoading(false); if (mode === 'login') web.current?.injectJavaScript(IG_LOGIN_CHECK_JS); }}
            onNavigationStateChange={(n) => { if (mode === 'login' && !n.loading) web.current?.injectJavaScript(IG_LOGIN_CHECK_JS); }}
            style={{ flex: 1, backgroundColor: c.bg }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hidden: { position: 'absolute', left: -2000, top: 0, width: 360, height: 640, opacity: 0 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 52, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
  title: { fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 12.5, lineHeight: 17, paddingHorizontal: 16, paddingVertical: 10 },
});
