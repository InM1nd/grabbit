import { DialogProvider } from './src/ui/dialog';
import Ionicons from '@expo/vector-icons/Ionicons';
import NetInfo from '@react-native-community/netinfo';
import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';
import { useShareIntent } from 'expo-share-intent';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { BottomNav } from './src/ui/BottomNav';
import { AddPostPanel, type NewPost } from './src/ui/PostExperience';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, BackHandler, Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { extractUrl } from './src/core/url';
import * as db from './src/db';
import { onDataChanged } from './src/events';
import { deleteThumb, processQueue, reprocessInstagramUnavailable, retryAllNow, saveShared, semanticSearch } from './src/processor';
import { ensurePermission, rescheduleReminder, setupNotifications } from './src/reminders';
import { updateSettings, useSettings } from './src/settings';
import { DARK, LIGHT, ThemeContext, useColors } from './src/theme';
import { BoardsScreen } from './src/ui/BoardsScreen';
import { ActionSheet, IconBtn, MARK_ICON, markLabel } from './src/ui/common';
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
        <DialogProvider><Main key={lang} /></DialogProvider>
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
  const [debQuery, setDebQuery] = useState('');
  const [semantic, setSemantic] = useState(true);
  const [semActive, setSemActive] = useState(false);
  const [markFilter, setMarkFilter] = useState<db.MarkFilter>('default');
  const [markPost, setMarkPost] = useState<db.Post | null>(null);
  const offlineWarned = useRef(false);
  useEffect(() => { const h = setTimeout(() => setDebQuery(query), query ? 450 : 0); return () => clearTimeout(h); }, [query]);
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
  const [toastA] = useState(() => new Animated.Value(0));
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
    const q = debQuery.trim();
    const [textHits, b, all, n] = await Promise.all([db.listPosts({ boardId, query: q, mark: markFilter }), db.listBoards(), db.listPosts(), db.countPending()]);
    let p = textHits;
    let sem = false;
    if (q && semantic) {
      const pool = all.filter((x) => (boardId == null || x.boardId === boardId) && db.markAllowed(x.mark, markFilter));
      const hits = await semanticSearch(q, pool);
      if (hits) {
        sem = true;
        // meaning-ranked first, then exact text matches the embedding missed
        const ids = new Set(hits.map((x) => x.id));
        p = [...hits, ...textHits.filter((x) => !ids.has(x.id))];
      } else if (!offlineWarned.current) {
        offlineWarned.current = true;
        toast(t('Поиск по смыслу недоступен — ищу по словам'));
      }
    }
    setSemActive(sem);
    setPosts((prev) => reuseUnchanged(prev, p));
    setBoards(b);
    setUnsorted(all.filter((x) => x.boardId == null).length);
    setPending(n);
  }, [boardId, debQuery, semantic, markFilter, toast]);
  useEffect(() => { const timer = setTimeout(() => { void reload(); }, 0); return () => clearTimeout(timer); }, [reload]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = onDataChanged(() => { if (t) clearTimeout(t); t = setTimeout(reload, 250); });
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
      setDetailId(null); setSettingsOpen(false); setAdding(null);
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
  const addLink = async (input: NewPost): Promise<db.Post> => {
    const r = await saveShared(input.url, null, null, { note: input.note || null, boardId: input.boardId });
    if (r.status === 'no-url') throw new Error(t('Это не похоже на ссылку'));
    if (r.status === 'duplicate') throw new Error(t('Уже сохранено'));
    const post = await db.getPost(r.id);
    if (!post) throw new Error(t('Не удалось сохранить. Попробуй ещё раз.'));
    setTab('feed'); setBoardId(null); setQuery(''); setMarkFilter('default');
    processQueue(r.id).then(rescheduleReminder).catch(() => {});
    ensurePermission().catch(() => {});
    return post;
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

  const openPost = useCallback((p: db.Post) => setDetailId(p.id), []);
  const visiblePosts = React.useMemo(() => (hidden.size ? posts.filter((p) => !hidden.has(p.id)) : posts), [posts, hidden]);
  const currentBoard = boards.find((b) => b.id === boardId);

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <Image source={require('./assets/icon.png')} style={styles.brandIcon} />
        <Text style={[styles.logo, { color: c.text }]} numberOfLines={1}>{tab === 'boards' ? t('Доски') : currentBoard ? `${currentBoard.emoji ?? ''} ${currentBoard.name}`.trim() : 'Grabbit'}</Text>
        <IconBtn name="settings-outline" onPress={() => setSettingsOpen(true)} label={t('Настройки')} />
      </View>
      {tab === 'feed' && <View style={styles.searchWrap}><View style={[styles.search, { backgroundColor: c.card }]}>
        <Ionicons name="search" size={18} color={c.faint} />
        <TextInput value={query} onChangeText={setQuery} onFocus={() => setSearching(true)} onBlur={() => setSearching(false)} accessibilityLabel={t('Поиск')} placeholder={semantic ? t('Спроси: «как монтировать видео»') : t('Поиск: слово, тег, автор')} placeholderTextColor={c.faint}
          style={[styles.searchInput, { color: c.text }]} returnKeyType="search" />
        <Pressable onPress={() => { offlineWarned.current = false; setSemantic(!semantic); }} hitSlop={6} accessibilityLabel={t('по смыслу')}
          style={[styles.semBtn, { backgroundColor: semantic ? c.chipActive : c.chip }]}><Text style={{ fontSize: 12, fontWeight: '600', color: semantic ? c.onChipActive : c.text }}>✨</Text></Pressable>
        {!!query && <IconBtn name="close" size={18} color={c.sub} onPress={() => setQuery('')} label={t('Закрыть')} />}
      </View></View>}

      <View style={{ flex: 1 }}>
        {tab === 'feed' ? (
          <FeedScreen posts={visiblePosts} boards={boards} boardId={boardId} setBoardId={setBoardId} query={debQuery} semantic={semActive}
            markFilter={markFilter} setMarkFilter={setMarkFilter} onLongPress={setMarkPost}
            onOpen={openPost} onSwipeDelete={swipeDelete}
            onRefresh={async () => { setRefreshing(true); await retryAllNow(); await reload(); setRefreshing(false); }} refreshing={refreshing} />
        ) : (
          <BoardsScreen boards={boards} unsortedCount={unsorted} onOpenBoard={(id) => { setBoardId(id); setTab('feed'); }} />
        )}
      </View>

      <BottomNav tab={tab} onChange={setTab} onAdd={openAdd} bottomInset={insets.bottom} />

      <HiddenInstagramLoader enabled={st.igConnected} />
      <ActionSheet visible={!!markPost} title={markPost ? (markPost.aiTitle || markPost.title || markPost.url).slice(0, 60) : undefined} onClose={() => setMarkPost(null)} actions={[
        ...(['try', 'done', 'skip'] as const).map((m) => ({
          label: `${markLabel(m)}${markPost?.mark === m ? '  ✓' : ''}`, icon: MARK_ICON[m],
          // eslint-disable-next-line react-hooks/refs -- This callback runs on a user press, not while rendering the action list.
          onPress: async () => { if (markPost) { await db.setMark(markPost.id, markPost.mark === m ? null : m); if (m === 'skip' && markPost.mark !== 'skip') toast(t('Скрыто из ленты: «Неважно»')); } },
        })),
        ...(markPost?.mark ? [{ label: t('Снять отметку'), icon: 'close-circle-outline', onPress: () => { if (markPost) db.setMark(markPost.id, null); } }] : []),
      ]} />
      <DetailScreen postId={detailId} boards={boards} onClose={() => setDetailId(null)} onOpenPost={setDetailId} toast={toast} onConnectInstagram={() => setIgMode('login')} />
      <SettingsScreen visible={settingsOpen} onClose={() => setSettingsOpen(false)} boards={boards} pendingCount={pending} toast={toast} onInstagram={setIgMode} initialUpdate={updateInfo} />
      <InstagramLoginModal visible={igMode != null} mode={igMode ?? 'login'} onClose={() => setIgMode(null)} onResult={onIgResult} />
      {adding != null && <AddPostPanel boards={boards} posts={posts} initialUrl={adding} onClose={() => setAdding(null)} onSave={addLink}
        onOpen={post => { setAdding(null); setDetailId(post.id); }} />}
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  brandIcon: { width: 34, height: 34, borderRadius: 11, marginRight: 10 },
  searchWrap: { paddingHorizontal: 16, marginBottom: 8, height: 46 },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 8, height: 72 },
  logo: { flex: 1, fontSize: 26, fontWeight: '800', letterSpacing: -0.6 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 16, paddingLeft: 14, height: 46, paddingRight: 8 },
  semBtn: { borderRadius: 14, paddingHorizontal: 9, height: 28, justifyContent: 'center', marginLeft: 4 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 15.5, paddingVertical: 0 },
  toast: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 11 },
  toastText: { fontSize: 14.5, fontWeight: '500' },
  toastAction: { fontSize: 14.5, fontWeight: '700' },
});

/** Keep previous object identity for unchanged posts so memoized cards don't re-render on every reload. */
function reuseUnchanged(prev: db.Post[], next: db.Post[]): db.Post[] {
  const old = new Map(prev.map((x) => [x.id, x]));
  let same = prev.length === next.length;
  const out = next.map((n, i) => {
    const o = old.get(n.id);
    const keep = o && (Object.keys(n) as (keyof db.Post)[]).every((k) => k === 'tags' ? o.tags.join('\u0001') === n.tags.join('\u0001') : o[k] === n[k]);
    const r = keep ? o! : n;
    if (r !== prev[i]) same = false;
    return r;
  });
  return same ? prev : out;
}
