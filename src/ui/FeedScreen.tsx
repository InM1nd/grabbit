import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Board, Post } from '../db';
import { useColors } from '../theme';
import { Chip } from './common';
import { Masonry } from './Masonry';
import { t } from '../i18n';

interface Props {
  posts: Post[];
  boards: Board[];
  boardId: number | null;
  setBoardId: (id: number | null) => void;
  query: string;
  onOpen: (p: Post) => void;
  onSwipeDelete: (p: Post) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export function FeedScreen({ posts, boards, boardId, setBoardId, query, onOpen, onSwipeDelete, onRefresh, refreshing }: Props) {
  const c = useColors();
  const header = (
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
  );
  const empty = (
    <View style={styles.empty}>
      {query ? (
        <>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('Ничего не нашлось')}</Text>
          <Text style={[styles.emptyText, { color: c.sub }]}>{t('Попробуй другое слово или тег.')}</Text>
        </>
      ) : (
        <>
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('Пока пусто')}</Text>
          <Text style={[styles.emptyText, { color: c.sub }]}>
            {t('В Instagram, TikTok, YouTube или X нажми «Поделиться» → Pinbox. ИИ опишет пост и положит на доску.')}
          </Text>
        </>
      )}
    </View>
  );
  return <Masonry posts={posts} onPress={onOpen} onSwipeDelete={onSwipeDelete} header={header} empty={empty} refreshing={refreshing} onRefresh={onRefresh} />;
}

const styles = StyleSheet.create({
  chips: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 14, gap: 8 },
  empty: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 90 },
  emptyTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  emptyText: { fontSize: 15, marginTop: 8, textAlign: 'center', lineHeight: 21 },
});
