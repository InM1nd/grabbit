import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Post } from '../db';
import { activeCount, type FeedFilter } from '../core/filters';
import { FilterButton } from './FilterSheet';
import { useColors } from '../theme';
import { Masonry } from './Masonry';
import { t } from '../i18n';

interface Props {
  posts: Post[];
  query: string;
  semantic?: boolean;
  filter: FeedFilter;
  onOpenFilters: () => void;
  onLongPress?: (p: Post) => void;
  onOpen: (p: Post) => void;
  onSwipeDelete: (p: Post) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export function FeedScreen({ posts, query, semantic, filter, onOpenFilters, onLongPress, onOpen, onSwipeDelete, onRefresh, refreshing }: Props) {
  const c = useColors();
  const header = (
    <>
    <View style={styles.bar}>
      <Text style={[styles.count, { color: c.sub }]}>{t('Постов: {n}', { n: posts.length })}</Text>
      <FilterButton filter={filter} onPress={onOpenFilters} />
    </View>
    {!!query && semantic && <Text style={[styles.hint, { color: c.sub }]}>{t('✨ Поиск по смыслу — самые близкие сверху')}</Text>}
    </>
  );
  const empty = (
    <View style={styles.empty}>
      {!query && activeCount(filter) > 0 ? (
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
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 2, paddingBottom: 12 },
  count: { fontSize: 13.5, fontWeight: '500' },
  hint: { fontSize: 13, paddingHorizontal: 18, marginTop: -6, marginBottom: 10 },
  empty: { alignItems: 'center', paddingHorizontal: 40, paddingTop: 90 },
  emptyTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  emptyText: { fontSize: 15, marginTop: 8, textAlign: 'center', lineHeight: 21 },
});
