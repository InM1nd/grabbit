import React, { useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { Post } from '../db';
import { PostCard, estimateHeight } from './PostCard';

interface Props {
  posts: Post[];
  boardNames: Map<number, string>;
  onPress: (p: Post) => void;
  onLongPress?: (p: Post) => void;
  header?: React.ReactNode;
  empty?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}

const PAD = 12, GAP = 10;

/** Two-column Pinterest-style layout: each card goes to the currently shorter column. */
export function Masonry({ posts, boardNames, onPress, onLongPress, header, empty, refreshing, onRefresh }: Props) {
  const { width } = useWindowDimensions();
  const colW = Math.floor((width - PAD * 2 - GAP) / 2);
  const cols = useMemo(() => {
    const c: [Post[], Post[]] = [[], []];
    const h = [0, 0];
    for (const p of posts) {
      const i = h[0] <= h[1] ? 0 : 1;
      c[i].push(p);
      h[i] += estimateHeight(p, colW) + GAP;
    }
    return c;
  }, [posts, colW]);
  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 110 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
    >
      {header}
      {posts.length === 0 ? empty : (
        <View style={[styles.row, { paddingHorizontal: PAD }]}>
          {cols.map((col, i) => (
            <View key={i} style={{ width: colW, marginLeft: i ? GAP : 0 }}>
              {col.map((p) => (
                <PostCard key={p.id} post={p} width={colW} boardName={p.boardId ? boardNames.get(p.boardId) : undefined} onPress={onPress} onLongPress={onLongPress} />
              ))}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'flex-start' } });
