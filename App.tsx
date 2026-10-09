import Ionicons from '@expo/vector-icons/Ionicons';
import NetInfo from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';
import { useShareIntent } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { extractUrl } from './src/core/url';
import * as db from './src/db';
import { onDataChanged } from './src/events';
import { processQueue, retryAllNow, saveShared } from './src/processor';
import { ensurePermission, remindersEnabled, rescheduleReminder, setRemindersEnabled, setupNotifications } from './src/reminders';
import { C } from './src/theme';
import { BoardsScreen } from './src/ui/BoardsScreen';
import { DetailScreen } from './src/ui/DetailScreen';
import { FeedScreen } from './src/ui/FeedScreen';
import { PromptModal } from './src/ui/PromptModal';
import { SaveOverlay, type SaveState } from './src/ui/SaveOverlay';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Main />
    </SafeAreaProvider>
  );
}

type Tab = 'feed' | 'boards';

function Main() {
  const insets = useSafeAreaInsets();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ resetOnBackground: true });
  const [tab, setTab] = useState<Tab>('feed');
  const [boardId, setBoardId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [posts, setPosts] = useState<db.Post[]>([]);
  const [boards, setBoards] = useState<db.Board[]>([]);
  const [unsorted, setUnsorted] = useState(0);
  const [pending, setPending] = useState(0);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [remOn, setRemOn] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fromShare = useRef(false);

  // ---------- toast ----------
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastA = useRef(new Animated.Value(0)).current;
  const toast = useCallback((m: string) => {
    setToastMsg(m);
    toastA.setValue(0);
    Animated.sequence([
      Animated.timing(toastA, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1800),
      Animated.timing(toastA, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => setToastMsg(null));
  }, [toastA]);

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

  // ---------- startup: notifications, queue, connectivity ----------
  useEffect(() => {
    setupNotifications();
    remindersEnabled().then(setRemOn);
    processQueue().then(rescheduleReminder);
    const offNet = NetInfo.addEventListener((s) => { if (s.isConnected) processQueue(); });
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') processQueue();
      if (st === 'background') rescheduleReminder();
    });
    // retry tick while the app is open (backoff is enforced by next_try_at)
    const tick = setInterval(() => { if (AppState.currentState === 'active') processQueue(); }, 45_000);
    // notification tap → open that post
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
      setDetailId(null);
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
      // hand the user back to the app they shared from
      BackHandler.exitApp();
    }
  }, []);

  // ---------- android back ----------
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (saveState) { finishShare(); return true; }
      if (detailId != null) { setDetailId(null); return true; }
      if (query) { setQuery(''); return true; }
      if (boardId != null) { setBoardId(null); return true; }
      if (tab !== 'feed') { setTab('feed'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [saveState, detailId, query, boardId, tab, finishShare]);

  const openAdd = async () => {
    let clip = '';
    try { clip = extractUrl(await Clipboard.getStringAsync()) || ''; } catch {}
    setAdding(clip);
  };
  const addLink = async (text: string) => {
    setAdding(null);
    const r = await saveShared(text, null, null);
    if (r.status === 'no-url') { toast('Это не похоже на ссылку'); return; }
    if (r.status === 'duplicate') { toast('Уже на полке'); setDetailId(r.id); return; }
    toast('Сохранено — ИИ разбирает');
    processQueue(r.id).then(rescheduleReminder);
    ensurePermission().catch(() => {});
  };

  const onRefresh = async () => { setRefreshing(true); await retryAllNow(); await reload(); setRefreshing(false); };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.logo}>{tab === 'feed' ? 'Полка' : 'Доски'}</Text>
        {tab === 'feed' && boardId != null && (
          <Pressable onPress={() => setBoardId(null)} style={styles.headerChip}>
            <Text style={styles.headerChipText}>Все посты</Text>
          </Pressable>
        )}
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'feed' ? (
          <FeedScreen
            posts={posts} boards={boards} boardId={boardId} setBoardId={setBoardId}
            query={query} setQuery={setQuery} onOpen={(p) => setDetailId(p.id)}
            onRefresh={onRefresh} refreshing={refreshing} pendingCount={pending}
          />
        ) : (
          <BoardsScreen
            boards={boards} unsortedCount={unsorted}
            onOpenBoard={(id) => { setBoardId(id); setTab('feed'); }}
            remindersOn={remOn}
            onToggleReminders={async (on) => {
              setRemOn(on);
              if (on) { const ok = await ensurePermission(); if (!ok) toast('Разреши уведомления в настройках Android'); }
              await setRemindersEnabled(on);
            }}
            pendingCount={pending}
            onRetry={async () => { toast('Обрабатываю очередь…'); await retryAllNow(); }}
          />
        )}
      </View>

      <View style={[styles.tabbar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TabBtn icon="grid-outline" label="Лента" active={tab === 'feed'} onPress={() => setTab('feed')} />
        <Pressable onPress={openAdd} style={styles.fab}><Ionicons name="add" size={30} color="#fff" /></Pressable>
        <TabBtn icon="albums-outline" label="Доски" active={tab === 'boards'} onPress={() => setTab('boards')} />
      </View>

      <DetailScreen postId={detailId} boards={boards} onClose={() => setDetailId(null)} toast={toast} />

      <PromptModal
        visible={adding != null}
        title="Добавить ссылку"
        hint="Вставь ссылку на пост, рилс, видео или статью."
        placeholder="https://…"
        initial={adding ?? ''}
        okLabel="Сохранить"
        onCancel={() => setAdding(null)}
        onOk={addLink}
      />

      <SaveOverlay
        state={saveState}
        onDone={finishShare}
        onOpen={(id) => { fromShare.current = false; setSaveState(null); setTab('feed'); setDetailId(id); }}
      />

      {toastMsg && (
        <Animated.View pointerEvents="none" style={[styles.toast, { bottom: 96 + insets.bottom, opacity: toastA, transform: [{ translateY: toastA.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
          <Text style={styles.toastText}>{toastMsg}</Text>
        </Animated.View>
      )}
    </View>
  );
}

function TabBtn({ icon, label, active, onPress }: { icon: any; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.tab} hitSlop={6}>
      <Ionicons name={active ? icon.replace('-outline', '') : icon} size={23} color={active ? C.text : C.faint} />
      <Text style={[styles.tabText, { color: active ? C.text : C.faint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 52 },
  logo: { fontSize: 26, fontWeight: '800', color: C.text, letterSpacing: -0.5 },
  headerChip: { marginLeft: 'auto', backgroundColor: C.accentSoft, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  headerChipText: { color: C.accent, fontWeight: '600', fontSize: 13 },
  tabbar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: 'rgba(255,255,255,0.97)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingTop: 8 },
  tab: { alignItems: 'center', width: 90 },
  tabText: { fontSize: 11.5, marginTop: 2, fontWeight: '500' },
  fab: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginTop: -22, elevation: 6, shadowColor: C.accent, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: 'rgba(29,27,26,0.92)', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
  toastText: { color: '#fff', fontSize: 14, fontWeight: '500' },
});
