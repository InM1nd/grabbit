import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import React, { memo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Post } from '../db';
import { PLATFORM_COLOR, PLATFORM_ICON, useColors } from '../theme';
import { t } from '../i18n';

/** Rough width/height of a thumbnail by platform — vertical video gets tall cards. */
export function thumbAspect(p: Post): number {
  if (p.platform === 'tiktok' || /\/shorts\//.test(p.url) || /\/reels?\//.test(p.url)) return 0.7;
  if (p.platform === 'youtube') return 16 / 9;
  if (p.platform === 'instagram') return 0.85;
  if (p.platform === 'x' || p.platform === 'github' || p.platform === 'web') return 1.6;
  return 1.2;
}

export const cardTitle = (p: Post) => p.aiTitle || p.title || p.url.replace(/^https?:\/\/(www\.)?/, '');

export function estimateHeight(p: Post, width: number): number {
  const hasImg = !!(p.localImage || p.image);
  const lines = Math.min(2, Math.ceil(cardTitle(p).length / 22));
  return hasImg ? width / thumbAspect(p) + 12 + lines * 19 + 14 : Math.max(110, 40 + Math.min(5, Math.ceil(cardTitle(p).length / 14)) * 23);
}

interface Props { post: Post; width: number; onPress: (p: Post) => void; onSwipeDelete?: (p: Post) => void }

function PostCardImpl({ post, width, onPress, onSwipeDelete }: Props) {
  const c = useColors();
  const img = post.localImage || post.image;
  const title = cardTitle(post);
  const pending = post.status === 'pending';
  const x = useRef(new Animated.Value(0)).current;
  const latest = useRef({ post, onSwipeDelete, width });
  latest.current = { post, onSwipeDelete, width };
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => !!latest.current.onSwipeDelete && g.dx < -14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => x.setValue(Math.min(0, g.dx)),
    onPanResponderRelease: (_, g) => {
      if (g.dx < -latest.current.width * 0.4 || g.vx < -1.2) {
        Animated.timing(x, { toValue: -latest.current.width * 1.3, duration: 160, useNativeDriver: true }).start(() => { latest.current.onSwipeDelete?.(latest.current.post); x.setValue(0); });
      } else Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(),
  })).current;
  const fade = x.interpolate({ inputRange: [-width, 0], outputRange: [0.3, 1], extrapolate: 'clamp' });

  return (
    <View style={{ marginBottom: 14 }}>
      <View style={[StyleSheet.absoluteFill, styles.trash]}><Ionicons name="trash-outline" size={22} color={c.danger} /></View>
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: x }], opacity: fade }}>
        <Pressable onPress={() => onPress(post)} style={({ pressed }) => ({ width, opacity: pressed ? 0.8 : 1 })}>
          {img ? (
            <View>
              <Image source={{ uri: img }} style={{ width, height: width / thumbAspect(post), borderRadius: 16, backgroundColor: c.card }} contentFit="cover" transition={120} recyclingKey={String(post.id)} />
              <View style={styles.badge}><Ionicons name={PLATFORM_ICON[post.platform] as any} size={11} color="#fff" /></View>
              {!post.openedAt && <View style={[styles.dot, { backgroundColor: c.accent }]} />}
              <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>{pending ? t('Разбираю…') : title}</Text>
            </View>
          ) : (
            <View style={[styles.block, { backgroundColor: PLATFORM_COLOR[post.platform] + (c.dark ? '33' : '1F') }]}>
              <Ionicons name={PLATFORM_ICON[post.platform] as any} size={16} color={c.sub} />
              <Text style={[styles.blockTitle, { color: c.text }]} numberOfLines={5}>{pending ? t('Разбираю…') : title}</Text>
              {!post.openedAt && <View style={[styles.dot, { backgroundColor: c.accent }]} />}
            </View>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

export const PostCard = memo(PostCardImpl);

const styles = StyleSheet.create({
  trash: { alignItems: 'flex-end', justifyContent: 'center', paddingRight: 16 },
  badge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 9, padding: 4 },
  dot: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 14, lineHeight: 19, fontWeight: '600', marginTop: 8, paddingHorizontal: 2 },
  block: { borderRadius: 16, padding: 14, minHeight: 110 },
  blockTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700', marginTop: 10 },
});
