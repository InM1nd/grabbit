import Ionicons from '@expo/vector-icons/Ionicons';
import NetInfo from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';
import { useShareIntent } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, BackHandler, Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { extractUrl } from './src/core/url';
import * as db from './src/db';
import { onDataChanged } from './src/events';
import { deleteThumb, processQueue, reprocessInstagramUnavailable, retryAllNow, saveShared } from './src/processor';
import { ensurePermission, rescheduleReminder, setupNotifications } from './src/reminders';
import { updateSettings, useSettings } from './src/settings';
import { DARK, LIGHT, ThemeContext, useColors } from './src/theme';
import { BoardsScreen } from './src/ui/BoardsScreen';
import { IconBtn, PromptModal } from './src/ui/common';
import { DetailScreen } from './src/ui/DetailScreen';
import { FeedScreen } from './src/ui/FeedScreen';
import { HiddenInstagramLoader, InstagramLoginModal } from './src/ui/InstagramWeb';
import { SaveOverlay, type SaveState } from './src/ui/SaveOverlay';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { consumeReopenSettings, resolveLang, setLang, t } from './src/i18n';
import { autoCheck, cleanupUpdates, type UpdateInfo } from './src/updater';

export default function App() {
  const s = useSettings();
  const sys = useColorScheme();
  const dark = s.theme === 'dark' || (s.theme === 'system' && sys === 'dark');
  const pal = dark ? DARK : LIGHT;
  const lang = resolveLang(s.uiLang);
  setLang(lang); // before children render
  return (
    <SafeAreaProvider>
      <ThemeContext.Provider value={pal}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <Main key={lang} />
      </ThemeContext.Provider>
    </SafeAreaProvider>
  );
}

type Tab = 'feed' | 'boards';
type Toast = { msg: string; action?: { label: string; onPress: () => void } } | null;

function Main() {
  const c = useColors();
  const st = useSettings();
  const insets = useSafeAreaInsets();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ resetOnBackground: true });
  const [tab, setTab] = useState<Tab>('feed');
  const [boardId, setBoardId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [posts, setPosts] = useState<db.Post[]>([]);
  const [boards, setBoards] = useState<db.Board[]>([]);
  const [unsorted, setUnsorted] = useState(0);
  const [pending, setPending] = useState(0);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [detailId, setDetailId] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(consumeReopenSettings);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [igMode, setIgMode] = useState<'login' | 'logout' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const fromShare = useRef(false);

  // ---------- toast (with optional action, e.g. undo) ----------
  const [toastState, setToastState] = useState<Toast>(null);
  const toastA = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((t: Toast, ms = 2200) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState(t);
    Animated.timing(toastA, { toValue: 1, duration: 160, useNativeDriver: true }).start();
    toastTimer.current = setTimeout(() => {
      Animated.timing(toastA, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setToastState(null));
    }, ms);
  }, [toastA]);
  const toast = useCallback((msg: string) => showToast({ msg }), [showToast]);

  // ---------- data ----------
  const reload = useCallback(async () => {
    const [p, b, all, n] = await Promise.all([db.listPosts({ boardId, query }), db.listBoards(), db.listPosts(), db.countPending()]);
    setPosts(p);
    setBoards(b);
    setUnsorted(all.filter((x) => x.boardId == null).length);
    setPending(n);
  }, [boardId, query]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = onDataChanged(() => { if (t) clearTimeout(t); t = setTimeout(reload, 120); });
    return () => { off(); if (t) clearTimeout(t); };
  }, [reload]);

  // ---------- startup ----------
  useEffect(() => {
    setupNotifications();
    processQueue().then(rescheduleReminder);
    cleanupUpdates();
    setTimeout(() => {
      autoCheck().then((info) => {
        if (!info) return;
        setUpdateInfo(info);
        showToast({ msg: t('Доступна версия {v}', { v: info.version }), action: { label: t('Обновить'), onPress: () => { setToastState(null); setSettingsOpen(true); } } }, 8000);
      });
    }, 4000);
    const offNet = NetInfo.addEventListener((s) => { if (s.isConnected) processQueue(); });
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') processQueue();
      if (s === 'background') rescheduleReminder();
    });
    const tick = setInterval(() => { if (AppState.currentState === 'active') processQueue(); }, 45_000);
    const openFromNotif = (r: Notifications.NotificationResponse | null) => {
      const id = Number((r?.notification.request.content.data as any)?.postId);
      if (id) { setDetailId(id); setTab('feed'); }
    };
    Notifications.getLastNotificationResponseAsync().then((r) => { openFromNotif(r); Notifications.clearLastNotificationResponseAsync().catch(() => {}); });
    const nsub = Notifications.addNotificationResponseReceivedListener(openFromNotif);
    return () => { offNet(); sub.remove(); clearInterval(tick); nsub.remove(); };
  }, []);

  // ---------- incoming share ----------
  useEffect(() => {
    if (!hasShareIntent) return;
    const si = shareIntent;
    resetShareIntent();
    (async () => {
      fromShare.current = true;
      setDetailId(null); setSettingsOpen(false);
      const r = await saveShared(si.text, si.webUrl, si.meta?.title ?? null);
      if (r.status === 'no-url') { setSaveState({ kind: 'no-url' }); return; }
      setSaveState({ kind: r.status === 'duplicate' ? 'duplicate' : 'saved', id: r.id });
      if (r.status === 'saved') {
        processQueue(r.id).then(rescheduleReminder);
        ensurePermission().catch(() => {});
      }
    })();
  }, [hasShareIntent]);

  const finishShare = useCallback(() => {
    setSaveState(null);
    if (fromShare.current) {
      fromShare.current = false;
      if (st.returnDelay >= 0) BackHandler.exitApp(); // back to the app the user shared from
    }
  }, [st.returnDelay]);

  // ---------- swipe-delete with undo ----------
  const swipeDelete = useCallback((p: db.Post) => {
    setHidden((h) => new Set(h).add(p.id));
    let undone = false;
    showToast({ msg: t('Удалено'), action: { label: t('Отменить'), onPress: () => { undone = true; setHidden((h) => { const n = new Set(h); n.delete(p.id); return n; }); toastA.setValue(0); setToastState(null); } } }, 4000);
    setTimeout(async () => {
      if (undone) return;
      deleteThumb(p.id);
      await db.deletePost(p.id);
      setHidden((h) => { const n = new Set(h); n.delete(p.id); return n; });
    }, 4200);
  }, [showToast, toastA]);

  // ---------- android back ----------
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (saveState) { finishShare(); return true; }
      if (searching) { setSearching(false); setQuery(''); return true; }
      if (boardId != null) { setBoardId(null); return true; }
      if (tab !== 'feed') { setTab('feed'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [saveState, searching, boardId, tab, finishShare]);

  const openAdd = async () => {
    let clip = '';
    try { clip = extractUrl(await Clipboard.getStringAsync()) || ''; } catch {}
    setAdding(clip);
  };
  const addLink = async (text: string) => {
    setAdding(null);
    const r = await saveShared(text, null, null);
    if (r.status === 'no-url') { toast(t('Это не похоже на ссылку')); return; }
    if (r.status === 'duplicate') { toast(t('Уже сохранено')); setDetailId(r.id); return; }
    toast(t('Сохранено — ИИ разбирает'));
    processQueue(r.id).then(rescheduleReminder);
    ensurePermission().catch(() => {});
  };

  const onIgResult = async (loggedIn: boolean, userId: string | null) => {
    const mode = igMode;
    setIgMode(null);
    await updateSettings({ igConnected: loggedIn, igUserId: loggedIn ? userId : null });
    if (mode === 'login' && loggedIn) {
      const n = await reprocessInstagramUnavailable();
      toast(n ? t('Instagram подключён — перечитываю {n}', { n }) : t('Instagram подключён'));
    } else if (mode === 'logout') toast(loggedIn ? t('Не удалось выйти') : t('Вышел из Instagram'));
  };

  const visiblePosts = hidden.size ? posts.filter((p) => !hidden.has(p.id)) : posts;
  const currentBoard = boards.find((b) => b.id === boardId);

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: c.bg }]}>
      <View style={styles.header}>
        {searching && tab === 'feed' ? (
          <View style={[styles.search, { backgroundColor: c.card }]}>
            <Ionicons name="search" size={18} color={c.faint} />
            <TextInput value={query} onChangeText={setQuery} autoFocus placeholder={t('Поиск: слово, тег, автор')} placeholderTextColor={c.faint}
              style={[styles.searchInput, { color: c.text }]} returnKeyType="search" />
            <IconBtn name="close" size={20} color={c.sub} onPress={() => { setSearching(false); setQuery(''); }} />
          </View>
        ) : (
          <>
            <Text style={[styles.logo, { color: c.text }]} numberOfLines={1}>
              {tab === 'boards' ? t('Доски') : currentBoard ? `${currentBoard.emoji ?? ''} ${currentBoard.name}`.trim() : 'Pinbox'}
            </Text>
            {tab === 'feed' && <IconBtn name="search" onPress={() => setSearching(true)} label={t('Поиск')} />}
            <IconBtn name="settings-outline" onPress={() => setSettingsOpen(true)} label={t('Настройки')} />
          </>
        )}
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'feed' ? (
          <FeedScreen posts={visiblePosts} boards={boards} boardId={boardId} setBoardId={setBoardId} query={query}
            onOpen={(p) => setDetailId(p.id)} onSwipeDelete={swipeDelete}
            onRefresh={async () => { setRefreshing(true); await retryAllNow(); await reload(); setRefreshing(false); }} refreshing={refreshing} />
        ) : (
          <BoardsScreen boards={boards} unsortedCount={unsorted} onOpenBoard={(id) => { setBoardId(id); setTab('feed'); }} />
        )}
      </View>

      <View style={[styles.tabbar, { paddingBottom: Math.max(insets.bottom, 8), backgroundColor: c.tabbar, borderTopColor: c.line }]}>
        <TabBtn icon="grid-outline" label={t('Лента')} active={tab === 'feed'} onPress={() => setTab('feed')} />
        <TabBtn icon="albums-outline" label={t('Доски')} active={tab === 'boards'} onPress={() => setTab('boards')} />
      </View>
      <Pressable onPress={openAdd} accessibilityLabel={t('Добавить ссылку')}
        style={({ pressed }) => [styles.fab, { bottom: Math.max(insets.bottom, 8) + 64, backgroundColor: c.text, opacity: pressed ? 0.85 : 1 }]}>
        <Ionicons name="add" size={26} color={c.bg} />
      </Pressable>

      <HiddenInstagramLoader enabled={st.igConnected} />
      <DetailScreen postId={detailId} boards={boards} onClose={() => setDetailId(null)} toast={toast} onConnectInstagram={() => setIgMode('login')} />
      <SettingsScreen visible={settingsOpen} onClose={() => setSettingsOpen(false)} boards={boards} pendingCount={pending} toast={toast} onInstagram={setIgMode} initialUpdate={updateInfo} />
      <InstagramLoginModal visible={igMode != null} mode={igMode ?? 'login'} onClose={() => setIgMode(null)} onResult={onIgResult} />
      <PromptModal visible={adding != null} title={t('Добавить ссылку')} hint={t('Пост, рилс, видео или статья.')} placeholder="https://…"
        initial={adding ?? ''} okLabel={t('Сохранить')} onCancel={() => setAdding(null)} onOk={addLink} />
      <SaveOverlay state={saveState} delaySec={st.returnDelay} onDone={finishShare}
        onOpen={(id) => { fromShare.current = false; setSaveState(null); setTab('feed'); setDetailId(id); }} />

      {toastState && (
        <Animated.View pointerEvents="box-none" style={[styles.toast, { bottom: Math.max(insets.bottom, 8) + 130, backgroundColor: c.text, opacity: toastA, transform: [{ translateY: toastA.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
          <Text style={[styles.toastText, { color: c.bg }]}>{toastState.msg}</Text>
          {toastState.action && (
            <Pressable onPress={toastState.action.onPress} hitSlop={10} style={{ marginLeft: 14 }}>
              <Text style={[styles.toastAction, { color: c.accent }]}>{toastState.action.label}</Text>
            </Pressable>
          )}
        </Animated.View>
      )}
    </View>
  );
}

function TabBtn({ icon, label, active, onPress }: { icon: string; label: string; active: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} style={styles.tab} hitSlop={6}>
      <Ionicons name={(active ? icon.replace('-outline', '') : icon) as any} size={22} color={active ? c.text : c.faint} />
      <Text style={[styles.tabText, { color: active ? c.text : c.faint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 8, height: 56 },
  logo: { flex: 1, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingLeft: 14, height: 44, marginRight: 6 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 15.5, paddingVertical: 0 },
  tabbar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  tab: { alignItems: 'center', width: 110 },
  tabText: { fontSize: 11.5, marginTop: 2, fontWeight: '500' },
  fab: { position: 'absolute', right: 18, width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  toast: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 11 },
  toastText: { fontSize: 14.5, fontWeight: '500' },
  toastAction: { fontSize: 14.5, fontWeight: '700' },
});
