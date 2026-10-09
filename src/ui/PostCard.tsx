import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import React, { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { PLATFORM_LABEL } from '../core/url';
import type { Post } from '../db';
import { C, PLATFORM_COLOR, PLATFORM_ICON } from '../theme';

/** Rough aspect ratio of a thumbnail (width / height) by platform/url — vertical video gets tall cards. */
export function thumbAspect(p: Post): number {
  if (p.platform === 'tiktok' || /\/shorts\//.test(p.url) || /\/reels?\//.test(p.url)) return 0.68;
  if (p.platform === 'youtube') return 16 / 9;
  if (p.platform === 'instagram') return 0.85;
  if (p.platform === 'x' || p.platform === 'github' || p.platform === 'web') return 1.6;
  return 1.2;
}

export function estimateHeight(p: Post, width: number): number {
  const img = p.localImage || p.image ? width / thumbAspect(p) : 0;
  const title = (p.aiTitle || p.title || p.url).length;
  const titleLines = Math.min(3, Math.ceil(title / 22));
  const sumLines = p.summary ? 3 : 0;
  return img + 24 + titleLines * 19 + sumLines * 17 + 30 + (img ? 0 : 20);
}

interface Props { post: Post; width: number; boardName?: string; onPress: (p: Post) => void; onLongPress?: (p: Post) => void }

function PostCardImpl({ post, width, boardName, onPress, onLongPress }: Props) {
  const img = post.localImage || post.image;
  const title = post.aiTitle || post.title || post.url.replace(/^https?:\/\/(www\.)?/, '');
  const pending = post.status === 'pending';
  return (
    <Pressable
      onPress={() => onPress(post)}
      onLongPress={() => onLongPress?.(post)}
      style={({ pressed }) => [styles.card, { width, opacity: pressed ? 0.85 : 1 }]}
    >
      {img ? (
        <Image
          source={{ uri: img }}
          style={{ width, height: width / thumbAspect(post), backgroundColor: C.chip }}
          contentFit="cover"
          transition={150}
          recyclingKey={String(post.id)}
        />
      ) : (
        <View style={[styles.noImg, { backgroundColor: PLATFORM_COLOR[post.platform] + '14' }]}>
          <Ionicons name={PLATFORM_ICON[post.platform] as any} size={28} color={PLATFORM_COLOR[post.platform]} />
        </View>
      )}
      <View style={styles.badge}>
        <Ionicons name={PLATFORM_ICON[post.platform] as any} size={12} color="#fff" />
      </View>
      {!post.openedAt && <View style={styles.dot} />}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={3}>{title}</Text>
        {!!post.summary && <Text style={styles.summary} numberOfLines={3}>{post.summary}</Text>}
        <View style={styles.footer}>
          {pending ? (
            <View style={styles.row}>
              <ActivityIndicator size="small" color={C.accent} style={{ transform: [{ scale: 0.7 }] }} />
              <Text style={styles.meta}>ИИ разбирает…</Text>
            </View>
          ) : post.status === 'error' ? (
            <Text style={[styles.meta, { color: C.warn }]}>Без описания ИИ</Text>
          ) : (
            <Text style={styles.meta} numberOfLines={1}>{boardName || PLATFORM_LABEL[post.platform]}</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export const PostCard = memo(PostCardImpl);

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 16, overflow: 'hidden', marginBottom: 10, elevation: 1, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  noImg: { height: 64, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 10, padding: 4 },
  dot: { position: 'absolute', top: 10, right: 10, width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent, borderWidth: 2, borderColor: '#fff' },
  body: { padding: 10, paddingTop: 8 },
  title: { fontSize: 14.5, lineHeight: 19, fontWeight: '600', color: C.text },
  summary: { marginTop: 4, fontSize: 12.5, lineHeight: 17, color: C.sub },
  footer: { marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginLeft: -6 },
  meta: { fontSize: 11.5, color: C.faint },
});
