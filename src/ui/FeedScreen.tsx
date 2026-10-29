import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Board, MarkFilter, Post } from '../db';
import { useColors } from '../theme';
import { Chip, markLabel } from './common';
import { Masonry } from './Masonry';
import { t } from '../i18n';

interface Props {
  posts: Post[];
  boards: Board[];
  boardId: number | null;
  setBoardId: (id: number | null) => void;
  query: string;
  semantic?: boolean;
  markFilter: MarkFilter;
  setMarkFilter: (f: MarkFilter) => void;
  onLongPress?: (p: Post) => void;
  onOpen: (p: Post) => void;
  onSwipeDelete: (p: Post) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export function FeedScreen({ posts, boards, boardId, setBoardId, query, semantic, markFilter, setMarkFilter, onLongPress, onOpen, onSwipeDelete, onRefresh, refreshing }: Props) {
  const c = useColors();
  const markChips: { f: MarkFilter; label: string }[] = [
    { f: 'try', label: `🧪 ${markLabel('try')}` },
    { f: 'done', label: `✅ ${markLabel('done')}` },
    { f: 'skip', label: `💤 ${markLabel('skip')}` },
    { f: 'all', label: t('Показать все') },
  ];
  const header = (
    <>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
      <Chip label={boardId == null ? `${t('Все')} · ${posts.length}` : t('Все')} active={boardId == null} onPress={() => setBoardId(null)} />
      {boards.map((b) => (
        <Chip
          key={b.id}
          label={`${b.emoji ? b.emoji + ' ' : ''}${b.name}${b.id === boardId ? ` · ${posts.length}` : ''}`}
          active={b.id === boardId}
          onPress={() => setBoardId(b.id === boardId ? null : b.id)}
        />
      ))}
    </ScrollView>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.marks} keyboardShouldPersistTaps="handled">
      {markChips.map((m) => (
        <Chip key={m.f} label={m.label} active={markFilter === m.f} onPress={() => setMarkFilter(markFilter === m.f ? 'default' : m.f)} />
      ))}
    </ScrollView>
    {!!query && semantic && <Text style={[styles.hint, { color: c.sub }]}>{t('✨ Поиск по смыслу — самые близкие сверху')}</Text>}
    </>
  );
  const empty = (
    <View style={styles.empty}>
      {!query && markFilter !== 'default' ? (
        <>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('Здесь пока ничего')}</Text>
          <Text style={[styles.emptyText, { color: c.sub }]}>{t('Долгое нажатие на карточку — отметить «Попробовать», «Сделано» или «Неважно».')}</Text>
        </>
      ) : query ? (
        <>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('Ничего не нашлось')}</Text>
          <Text style={[styles.emptyText, { color: c.sub }]}>{t('Попробуй другое слово или тег.')}</Text>
        </>
      ) : (
        <>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('Пока пусто')}</Text>
          <Text style={[styles.emptyText, { color: c.sub }]}>
            {t('В Instagram, TikTok, YouTube или X нажми «Поделиться» → Grabbit. ИИ опишет пост и положит на доску.')}
          </Text>
        </>
      )}
    </View>
  );
  return <Masonry posts={posts} onPress={onOpen} onSwipeDelete={onSwipeDelete} onLongPress={onLongPress} header={header} empty={empty} refreshing={refreshing} onRefresh={onRefresh} />;
}

const styles = StyleSheet.create({
  chips: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 8, gap: 8 },
  marks: { paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
  hint: { fontSize: 13, paddingHorizontal: 18, marginTop: -6, marginBottom: 10 },
  empty: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 90 },
  emptyTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  emptyText: { fontSize: 15, marginTop: 8, textAlign: 'center', lineHeight: 21 },
});
