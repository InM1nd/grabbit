import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { summarizeBoard, topicKey } from '../core/boardView';
import { DEFAULT_FILTER } from '../core/filters';
import { t } from '../i18n';
import { useColors } from '../theme';
import { FeedScreen } from './FeedScreen';
import { cardTitle } from './PostCard';

type Props = Omit<React.ComponentProps<typeof FeedScreen>, 'query' | 'filter'> & { showOverview: boolean };

export function BoardFeed({ posts, showOverview, extraHeader, onOpen, ...props }: Props) {
  const c = useColors();
  const [topic, setTopic] = useState<string | null>(null);
  const overview = useMemo(() => summarizeBoard(posts), [posts]);
  const active = overview.topics.some(item => item.key === topic) ? topic : null;
  const visible = active == null ? posts : posts.filter(post => post.mark !== 'skip' && post.tags.some(tag => topicKey(tag) === active));
  return <FeedScreen {...props} posts={visible} onOpen={onOpen} query="" filter={DEFAULT_FILTER} extraHeader={<>
    {extraHeader}
    {showOverview && posts.length > 0 && <View style={[styles.card, { backgroundColor: c.card }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: c.text }]}>{t('Что на доске')}</Text>
      <Text style={{ color: c.sub, fontSize: 13 }}>{t('Не открыто: {n}', { n: overview.unread })} · {t('Попробовать: {n}', { n: overview.toTry })}</Text>
      {!!overview.topics.length && <View style={styles.topics}>
        {overview.topics.map(item => <Pressable key={item.key} accessibilityRole="button" aria-pressed={active === item.key}
          onPress={() => setTopic(active === item.key ? null : item.key)}
          style={[styles.chip, { backgroundColor: active === item.key ? c.chipActive : c.bg }]}>
          <Text style={{ color: active === item.key ? c.onChipActive : c.text, fontSize: 13 }}>#{item.key} · {item.count}</Text>
        </Pressable>)}
      </View>}
      {active == null && overview.samples.map(post => <Pressable key={post.id} accessibilityRole="button" onPress={() => onOpen(post)}
        style={styles.sample}><Text style={{ color: c.text, flex: 1 }} numberOfLines={1}>{cardTitle(post)}</Text>
        <Ionicons name="arrow-forward" color={c.accent} size={16} />
      </Pressable>)}
    </View>}
  </>} />;
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 14, marginBottom: 14, padding: 14, borderRadius: 18, gap: 9 },
  title: { fontSize: 16, fontWeight: '700' },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { minHeight: 34, justifyContent: 'center', paddingHorizontal: 11, borderRadius: 17 },
  sample: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
});
