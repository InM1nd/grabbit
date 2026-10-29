import React, { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { Post } from './src/db';
import { applyFilter, DEFAULT_FILTER, type FeedFilter } from './src/core/filters';
import { FilterSheet } from './src/ui/FilterSheet';
import { DARK, LIGHT, ThemeContext } from './src/theme';
import { FeedScreen } from './src/ui/FeedScreen';
import { BottomNav } from './src/ui/BottomNav';
import { AddPostPanel, PostPanel } from './src/ui/PostExperience';
import { detectPlatform } from './src/core/url';
import { previewBoards, previewPosts } from './src/preview/data';

// Browser-only design playground. Native builds continue to use App.tsx.
function Preview() {
  const [dark, setDark] = useState(false);
  const [posts, setPosts] = useState(previewPosts);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FeedFilter>(DEFAULT_FILTER);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detail, setDetail] = useState<Post | null>(null);
  const [deleted, setDeleted] = useState<Post | null>(null);
  const [tab, setTab] = useState<'feed' | 'boards'>('feed');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const c = dark ? DARK : LIGHT;
  const boards = previewBoards.map(board => ({ ...board, count: posts.filter(p => p.boardId === board.id).length,
    covers: posts.filter(p => p.boardId === board.id && p.image).map(p => p.image!) }));
  const reset = () => { setPosts(previewPosts); setDeleted(null); setFilter(DEFAULT_FILTER); setQuery(''); setTab('feed'); };
  const matched = posts.filter(p => `${p.title} ${p.summary} ${p.tags.join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const visible = applyFilter(matched, filter);
  const remove = (post: Post) => { setPosts(prev => prev.filter(p => p.id !== post.id)); setDeleted(post); };

  return <SafeAreaProvider><ThemeContext.Provider value={c}>
    <View style={[s.app, { backgroundColor: c.bg }]}>
      <View style={[s.notice, { backgroundColor: c.accentSoft }]}><Text style={{ color: c.sub, fontSize: 11 }}>Дизайн-превью · тестовые посты</Text></View>
      <View style={s.header}>
        <Image source={require('./assets/icon.png')} style={s.logo} accessibilityLabel="Зайчик Grabbit" />
        <Text style={[s.wordmark, { color: c.text }]}>{tab === 'boards' ? 'Доски' : 'Grabbit'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Настройки" onPress={() => setSettingsOpen(true)} style={s.iconButton}><Ionicons name="settings-outline" size={24} color={c.text} /></Pressable>
      </View>
      {tab === 'feed' && <View style={[s.search, { backgroundColor: c.card }]}>
        <Ionicons name="search-outline" color={c.sub} size={20} />
        <TextInput accessibilityLabel="Поиск по сохранённым постам" placeholder="Найти в сохранённом" placeholderTextColor={c.faint} value={query} onChangeText={setQuery} style={[s.input, { color: c.text }]} />
      </View>}
      <View style={{ flex: 1, minHeight: 0 }}>
      {tab === 'feed' ? <FeedScreen posts={visible} query={query}
        filter={filter} onOpenFilters={() => setFiltersOpen(true)} onOpen={setDetail} onSwipeDelete={remove}
        onRefresh={() => { setPosts(previewPosts); setDeleted(null); }} refreshing={false} /> :
        <ScrollView contentContainerStyle={s.boards}>
          <Text style={[s.boardsIntro, { color: c.sub }]}>Всё сохранённое — по своим местам</Text>
          <View style={s.boardGrid}>{boards.map(board => <Pressable key={board.id} accessibilityRole="button" accessibilityLabel={`Открыть доску ${board.name}`} onPress={() => { setFilter({ ...DEFAULT_FILTER, boards: [board.id] }); setQuery(''); setTab('feed'); }} style={({ pressed }) => [s.board, { opacity: pressed ? 0.8 : 1 }]}>
            <View style={[s.boardCover, { backgroundColor: c.card }]}>
              {board.covers[0] ? <Image source={{ uri: board.covers[0] }} contentFit="cover" style={StyleSheet.absoluteFill} /> : <Text style={{ fontSize: 40 }}>{board.emoji}</Text>}
              {board.covers[0] && <View style={[s.boardEmoji, { backgroundColor: c.bg }]}><Text style={{ fontSize: 20 }}>{board.emoji}</Text></View>}
            </View>
            <Text style={[s.boardName, { color: c.text }]}>{board.name}</Text>
            <Text style={{ color: c.sub, fontSize: 13 }}>{board.count} сохранено</Text>
          </Pressable>)}</View>
        </ScrollView>}
      </View>
      {deleted && <View style={[s.undo, { backgroundColor: c.text }]}><Text style={{ color: c.bg }}>Пост удалён</Text><Pressable accessibilityRole="button" onPress={() => { setPosts(prev => [...prev, deleted].sort((a, b) => a.id - b.id)); setDeleted(null); }}><Text style={{ color: dark ? '#F8483E' : '#FFACA5', fontWeight: '700' }}>Отменить</Text></Pressable></View>}
      <FilterSheet visible={filtersOpen} filter={filter} posts={matched} boards={boards} onApply={(f) => { setFilter(f); setFiltersOpen(false); }} onClose={() => setFiltersOpen(false)} />
      <BottomNav tab={tab} onChange={setTab} onAdd={() => setAdding(true)} />
      <Modal visible={settingsOpen} animationType="none" onRequestClose={() => setSettingsOpen(false)}>
        <View style={[s.app, { backgroundColor: c.bg, width: '100%', maxWidth: 430, alignSelf: 'center' }]}>
          <View style={s.settingsHeader}><Pressable accessibilityRole="button" accessibilityLabel="Назад из настроек" onPress={() => setSettingsOpen(false)} style={s.iconButton}><Ionicons name="chevron-back" size={26} color={c.text} /></Pressable><Text style={[s.settingsTitle, { color: c.text }]}>Настройки</Text></View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            <Text style={[s.sectionTitle, { color: c.sub }]}>ОФОРМЛЕНИЕ</Text>
            <View style={[s.settingsGroup, { backgroundColor: c.card }]}>
              <Text style={[s.settingLabel, { color: c.text }]}>Тема</Text>
              <View style={s.themeOptions}>{([false, true] as const).map(value => <Pressable key={String(value)} accessibilityRole="radio" aria-checked={dark === value} accessibilityLabel={value ? 'Тёмная тема' : 'Светлая тема'} onPress={() => setDark(value)} style={[s.themeOption, { backgroundColor: dark === value ? c.text : c.bg }]}><Ionicons name={value ? 'moon-outline' : 'sunny-outline'} size={18} color={dark === value ? c.bg : c.text} /><Text style={{ color: dark === value ? c.bg : c.text }}>{value ? 'Тёмная' : 'Светлая'}</Text></Pressable>)}</View>
            </View>
            <Text style={[s.sectionTitle, { color: c.sub }]}>ПЕСОЧНИЦА</Text>
            <Pressable accessibilityRole="button" onPress={() => { reset(); setSettingsOpen(false); }} style={[s.settingsGroup, s.settingRow, { backgroundColor: c.card }]}><Ionicons name="refresh-outline" size={22} color={c.text} /><Text style={[s.settingLabel, { color: c.text }]}>Сбросить демо</Text><Ionicons name="chevron-forward" size={18} color={c.sub} /></Pressable>
            <Text style={[s.description, { color: c.sub, paddingHorizontal: 0, paddingTop: 8, fontSize: 13 }]}>Настройки превью действуют до перезагрузки страницы. Здесь можно проверить оформление и навигацию.</Text>
            <Text style={[s.sectionTitle, { color: c.sub }]}>В МОБИЛЬНОМ ПРИЛОЖЕНИИ</Text>
            <View style={[s.settingsGroup, { backgroundColor: c.card }]}>{['ИИ-описания', 'После «Поделиться»', 'Напоминания', 'Instagram', 'Импорт и экспорт', 'Обновления'].map((label, index) => <View key={label} style={[s.mobileSetting, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.line }]}><Text style={{ color: c.text, fontSize: 15 }}>{label}</Text><Text style={{ color: c.sub, fontSize: 11 }}>На телефоне</Text></View>)}</View>
          </ScrollView>
        </View>
      </Modal>
      {adding && <AddPostPanel preview boards={boards} posts={posts} onClose={() => setAdding(false)} onOpen={post => { setAdding(false); setDetail(post); }} onSave={input => {
        const post: Post = { ...previewPosts[0], id: Math.max(0, ...posts.map(p => p.id)) + 1,
          url: input.url, title: new URL(input.url).hostname, image: null, localImage: null,
          platform: detectPlatform(input.url), boardId: input.boardId, note: input.note || null,
          tags: [], mark: null, author: null, summary: null, description: null, createdAt: Date.now(), openedAt: null };
        setPosts(prev => [post, ...prev]); setFilter(DEFAULT_FILTER); setQuery(''); setTab('feed');
        return post;
      }} />}
      {detail && <PostPanel key={detail.id} post={detail} boards={boards} onClose={() => setDetail(null)}
        onUpdate={patch => { setPosts(prev => prev.map(p => p.id === detail.id ? { ...p, ...patch } : p)); setDetail(prev => prev ? { ...prev, ...patch } : null); }}
        onDelete={() => { remove(detail); setDetail(null); }} />}

    </View>
  </ThemeContext.Provider></SafeAreaProvider>;
}

export default function App() {
  if (window.location.search.includes('device=1') || window.innerWidth < 600) return <Preview />;
  return <main style={{ width: '100%', height: '100dvh', overflow: 'auto', background: '#ECECEE', display: 'grid', placeItems: 'center', fontFamily: 'system-ui' }}>
    <div style={{ padding: '24px 0' }}>
      <iframe title="Мобильное превью Grabbit" src="/?device=1" style={{ width: 390, height: 'min(844px, calc(100dvh - 100px))', minHeight: 520, border: '8px solid #252526', borderRadius: 40, background: '#fff', boxShadow: '0 24px 70px #00000018' }} />
      <p style={{ textAlign: 'center', color: '#626269', fontSize: 12 }}>Grabbit · живая песочница дизайна</p>
    </div>
  </main>;
}

const s = StyleSheet.create({
  app: { flex: 1 }, notice: { alignItems: 'center', paddingVertical: 7 },
  header: { height: 72, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 38, height: 38, borderRadius: 12 }, wordmark: { fontSize: 28, fontWeight: '800', letterSpacing: -0.9, flex: 1 },
  iconButton: { padding: 10, borderRadius: 24 }, search: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, paddingHorizontal: 14, borderRadius: 16, height: 46, marginBottom: 8, gap: 8 },
  input: { flex: 1, fontSize: 15, height: 44 },
  description: { fontSize: 15, lineHeight: 23, paddingHorizontal: 24, paddingBottom: 18 },
  boards: { padding: 16, paddingBottom: 100 }, boardsIntro: { fontSize: 14, marginBottom: 20 }, boardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, board: { width: '47.5%', marginBottom: 12 },
  boardCover: { aspectRatio: 1, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, boardEmoji: { position: 'absolute', bottom: 10, left: 10, borderRadius: 12, padding: 6 }, boardName: { fontSize: 17, fontWeight: '600', marginTop: 10, marginBottom: 4 },
  settingsHeader: { flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingHorizontal: 8 }, settingsTitle: { fontSize: 24, fontWeight: '700', marginLeft: 6 }, sectionTitle: { fontSize: 11, fontWeight: '600', letterSpacing: 1.2, marginTop: 20, marginBottom: 10 },
  settingsGroup: { borderRadius: 18, padding: 16 }, settingLabel: { fontSize: 16, fontWeight: '500', flex: 1 }, settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, themeOptions: { flexDirection: 'row', gap: 8, marginTop: 14 }, themeOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 12 }, mobileSetting: { paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  undo: { position: 'absolute', bottom: 154, left: 20, right: 20, padding: 16, borderRadius: 18, flexDirection: 'row', justifyContent: 'space-between' },
});
