import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, View, useWindowDimensions } from 'react-native';
import type { Post } from '../db';
import { useColors } from '../theme';
import { PostCard, estimateHeight } from './PostCard';

interface Props {
  posts: Post[];
  onPress: (p: Post) => void;
  onSwipeDelete?: (p: Post) => void;
  onLongPress?: (p: Post) => void;
  header?: React.ReactNode;
  empty?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}

const PAD = 14, GAP = 12;

/** Two-column Pinterest-style layout: each card goes to the currently shorter column. */
export function Masonry({ posts, onPress, onSwipeDelete, onLongPress, header, empty, refreshing, onRefresh }: Props) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const colW = Math.floor((width - PAD * 2 - GAP) / 2);
  const cols = useMemo(() => {
    const out: [Post[], Post[]] = [[], []];
    const h = [0, 0];
    for (const p of posts) {
      const i = h[0] <= h[1] ? 0 : 1;
      out[i].push(p);
      h[i] += estimateHeight(p, colW) + GAP;
    }
    return out;
  }, [posts, colW]);
  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[c.accent]} progressBackgroundColor={c.elevated} /> : undefined}
    >
      {header}
      {posts.length === 0 ? empty : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: PAD }}>
          {cols.map((col, i) => (
            <View key={i} style={{ width: colW, marginLeft: i ? GAP : 0 }}>
              {col.map((p) => <PostCard key={p.id} post={p} width={colW} onPress={onPress} onSwipeDelete={onSwipeDelete} onLongPress={onLongPress} />)}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
