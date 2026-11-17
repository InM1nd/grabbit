import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import React, { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Post } from '../db';
import { PLATFORM_COLOR, PLATFORM_ICON, useColors } from '../theme';
import { t } from '../i18n';
import { Appear, MARK_COLOR, MARK_GLYPH, PressScale } from './common';

/** Rough width/height of a thumbnail by platform — vertical video gets tall cards. */
export function thumbAspect(p: Post): number {
  if (p.platform === 'tiktok' || /\/shorts\//.test(p.url) || /\/reels?\//.test(p.url)) return 0.7;
  if (p.platform === 'youtube') return 16 / 9;
  if (p.platform === 'instagram') return 0.85;
  if (p.platform === 'x' || p.platform === 'github' || p.platform === 'web') return 1.6;
  return 1.2;
}

export const cardTitle = (p: Post) => p.aiTitle || p.title || p.url.replace(/^https?:\/\/(www\.)?/, '');

export function postProcessingLabel(post: Post): string | null {
  if (post.status === 'error') return t('Описание не готово');
  if (post.status !== 'pending') return null;
  if (post.nextTryAt > Date.now()) return t('Повторится позже');
  if (!post.metaFetched) return t('Читаю пост…');
  return t('Описание готовится');
}

export function estimateHeight(p: Post, width: number): number {
  const hasImg = !!(p.localImage || p.image);
  const lines = Math.min(2, Math.ceil(cardTitle(p).length / 22));
  const base = hasImg ? width / thumbAspect(p) + 12 + lines * 19 + 14 : Math.max(110, 40 + Math.min(5, Math.ceil(cardTitle(p).length / 14)) * 23);
  return p.status === 'done' ? base : base + 18;
}

export type CardAction = { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; onPress: (post: Post) => void };

interface Props { action?: CardAction; post: Post; width: number; onPress: (p: Post) => void; onSwipeDelete?: (p: Post) => void; onLongPress?: (p: Post) => void }

function PostCardImpl({ post, width, onPress, onSwipeDelete, onLongPress, action }: Props) {
  const c = useColors();
  const img = post.localImage || post.image;
  const title = cardTitle(post);
  const processing = postProcessingLabel(post);
  const status = processing && <Text style={[styles.processing, { color: post.status === 'error' ? c.warn : c.sub }]}>{processing}</Text>;
  const [x] = useState(() => new Animated.Value(0));
  const latest = useRef({ post, onSwipeDelete, width });
  useLayoutEffect(() => { latest.current = { post, onSwipeDelete, width }; }, [post, onSwipeDelete, width]);
  // PanResponder stores callbacks; refs are read only when gesture events fire.
  // eslint-disable-next-line react-hooks/refs
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => !!latest.current.onSwipeDelete && g.dx < -14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => x.setValue(Math.min(0, g.dx)),
    onPanResponderRelease: (_, g) => {
      if (g.dx < -latest.current.width * 0.4 || g.vx < -1.2) {
        Animated.timing(x, { toValue: -latest.current.width * 1.3, duration: 160, useNativeDriver: true, isInteraction: false }).start(() => { latest.current.onSwipeDelete?.(latest.current.post); x.setValue(0); });
      } else Animated.spring(x, { toValue: 0, useNativeDriver: true, isInteraction: false }).start();
    },
    onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true, isInteraction: false }).start(),
  }), [x]);
  const fade = x.interpolate({ inputRange: [-Math.max(width, 1), 0], outputRange: [0.3, 1], extrapolate: 'clamp' });
  // Text-only cards have a see-through tint, so the trash only appears while swiping.
  const trashOpacity = x.interpolate({ inputRange: [-40, -8], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <Appear style={{ marginBottom: 14 }}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.trash, { opacity: trashOpacity }]}><Ionicons name="trash-outline" size={22} color={c.danger} /></Animated.View>
      <Animated.View {...pan.panHandlers} style={{ transform: [{ translateX: x }], opacity: fade }}>
        <PressScale scaleTo={0.97} onPress={() => onPress(post)} onLongPress={onLongPress ? () => onLongPress(post) : undefined} delayLongPress={350} style={{ width }}>
          {img ? (
            <View>
              <Image source={{ uri: img }} style={{ width, height: width / thumbAspect(post), borderRadius: 16, backgroundColor: c.card }} contentFit="cover" cachePolicy="memory-disk" transition={0} recyclingKey={String(post.id)} />
              <View style={styles.badge}><Ionicons name={PLATFORM_ICON[post.platform] as any} size={11} color="#fff" /></View>
              {!post.openedAt && <View style={[styles.dot, { backgroundColor: c.accent }, !!post.mark && { right: 38 }]} />}
              {!!post.mark && <View style={[styles.statusDot, { backgroundColor: MARK_COLOR[post.mark], borderColor: c.dark ? '#0B0B0D' : '#FFFFFF' }]}><Ionicons name={MARK_GLYPH[post.mark] as any} size={13} color="#fff" /></View>}
              <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>{title}</Text>
              {status}
            </View>
          ) : (
            <View style={[styles.block, { backgroundColor: PLATFORM_COLOR[post.platform] + (c.dark ? '33' : '1F') }]}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Ionicons name={PLATFORM_ICON[post.platform] as any} size={16} color={c.sub} />
              </View>
              <Text style={[styles.blockTitle, { color: c.text }]} numberOfLines={5}>{title}</Text>
              {status}
              {!post.openedAt && <View style={[styles.dot, { backgroundColor: c.accent }, !!post.mark && { right: 38 }]} />}
              {!!post.mark && <View style={[styles.statusDot, { backgroundColor: MARK_COLOR[post.mark], borderColor: c.dark ? '#0B0B0D' : '#FFFFFF' }]}><Ionicons name={MARK_GLYPH[post.mark] as any} size={13} color="#fff" /></View>}
            </View>
          )}
        </PressScale>
        {action && <Pressable accessibilityRole="button" onPress={() => action.onPress(post)}
          style={({ pressed }) => [styles.action, { backgroundColor: pressed ? c.accentSoft : c.card }]}>
          <Ionicons name={action.icon} color={c.accent} size={16} />
          <Text style={{ color: c.text, fontWeight: '600', fontSize: 12, flexShrink: 1 }}>{action.label}</Text>
        </Pressable>}
      </Animated.View>
    </Appear>
  );
}

export const PostCard = memo(PostCardImpl);

const styles = StyleSheet.create({
  action: { marginTop: 6, borderRadius: 12, minHeight: 40, paddingHorizontal: 9, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  trash: { alignItems: 'flex-end', justifyContent: 'center', paddingRight: 16 },
  badge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 9, padding: 4 },
  statusDot: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3 },
  dot: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4 },
  title: { fontSize: 14, lineHeight: 19, fontWeight: '600', marginTop: 8, paddingHorizontal: 2 },
  block: { borderRadius: 16, padding: 14, minHeight: 110 },
  processing: { marginTop: 4, fontSize: 12, lineHeight: 14 },
  blockTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700', marginTop: 10 },
});
