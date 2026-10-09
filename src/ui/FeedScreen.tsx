import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Board, Post } from '../db';
import { C } from '../theme';
import { Masonry } from './Masonry';

interface Props {
  posts: Post[];
  boards: Board[];
  boardId: number | null;
  setBoardId: (id: number | null) => void;
  query: string;
  setQuery: (q: string) => void;
  onOpen: (p: Post) => void;
  onRefresh: () => void;
  refreshing: boolean;
  pendingCount: number;
}

export function FeedScreen({ posts, boards, boardId, setBoardId, query, setQuery, onOpen, onRefresh, refreshing, pendingCount }: Props) {
  const [focused, setFocused] = useState(false);
  const names = useMemo(() => new Map(boards.map((b) => [b.id, `${b.emoji ? b.emoji + ' ' : ''}${b.name}`])), [boards]);
  const current = boards.find((b) => b.id === boardId);
  const unopened = posts.filter((p) => !p.openedAt).length;

  const header = (
    <View>
      <View style={styles.searchWrap}>
        <View style={[styles.search, focused && { borderColor: C.accent }]}>
          <Ionicons name="search" size={18} color={C.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Поиск по описаниям и тегам"
            placeholderTextColor={C.faint}
            style={styles.input}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            returnKeyType="search"
          />
          {!!query && (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Ionicons name="close-circle" size={18} color={C.faint} />
            </Pressable>
          )}
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
        <Chip label="Все" active={boardId == null} onPress={() => setBoardId(null)} />
        {boards.map((b) => (
          <Chip key={b.id} label={`${b.emoji ? b.emoji + ' ' : ''}${b.name}`} count={b.count} active={b.id === boardId} onPress={() => setBoardId(b.id === boardId ? null : b.id)} />
        ))}
      </ScrollView>
      <Text style={styles.stats}>
        {current ? `${current.emoji ?? ''} ${current.name} · ` : ''}
        {posts.length} {query ? 'найдено' : 'сохранено'}
        {unopened ? ` · ${unopened} не открыто` : ''}
        {pendingCount ? ` · ИИ в очереди: ${pendingCount}` : ''}
      </Text>
    </View>
  );

  const empty = (
    <View style={styles.empty}>
      {query ? (
        <>
          <Text style={styles.emptyTitle}>Ничего не нашлось</Text>
          <Text style={styles.emptyText}>Попробуй другое слово или тег.</Text>
        </>
      ) : (
        <>
          <Text style={{ fontSize: 44 }}>📌</Text>
          <Text style={styles.emptyTitle}>Здесь будут твои находки</Text>
          <Text style={styles.emptyText}>
            В Instagram, TikTok, YouTube или X нажми «Поделиться» → «Полка». Пост сохранится сразу, а ИИ опишет его и разложит по доскам.
            {'\n\n'}Или нажми «+» и вставь ссылку.
          </Text>
        </>
      )}
    </View>
  );

  return <Masonry posts={posts} boardNames={names} onPress={onOpen} header={header} empty={empty} refreshing={refreshing} onRefresh={onRefresh} />;
}

function Chip({ label, active, onPress, count }: { label: string; active: boolean; onPress: () => void; count?: number }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && { color: '#fff' }]} numberOfLines={1}>
        {label}{count != null ? <Text style={{ opacity: 0.6 }}>  {count}</Text> : null}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 12, paddingTop: 4 },
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: C.line },
  input: { flex: 1, marginLeft: 8, fontSize: 15, color: C.text, paddingVertical: 0 },
  chips: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  chip: { backgroundColor: C.chip, borderRadius: 18, paddingHorizontal: 14, height: 34, justifyContent: 'center', maxWidth: 220 },
  chipActive: { backgroundColor: C.text },
  chipText: { fontSize: 13.5, color: C.text, fontWeight: '500' },
  stats: { paddingHorizontal: 14, paddingBottom: 8, color: C.faint, fontSize: 12 },
  empty: { alignItems: 'center', paddingHorizontal: 36, paddingTop: 60 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginTop: 10, textAlign: 'center' },
  emptyText: { fontSize: 14, color: C.sub, marginTop: 8, textAlign: 'center', lineHeight: 20 },
});
