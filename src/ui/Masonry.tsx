import { FlashList } from '@shopify/flash-list';
import React, { useCallback } from 'react';
import { RefreshControl, View, useWindowDimensions } from 'react-native';
import type { Post } from '../db';
import { useColors } from '../theme';
import { PostCard } from './PostCard';

interface Props {
  posts: Post[];
  onPress: (p: Post) => void;
  onSwipeDelete?: (p: Post) => void;
  onLongPress?: (p: Post) => void;
  header?: React.ReactElement;
  empty?: React.ReactElement;
  refreshing?: boolean;
  onRefresh?: () => void;
}

const PAD = 14, GAP = 12;
const keyOf = (p: Post) => String(p.id);
const typeOf = (p: Post) => ((p.localImage || p.image) ? 'img' : 'txt');

/** Virtualized two-column Pinterest-style layout (FlashList masonry): only visible cards are mounted. */
export function Masonry({ posts, onPress, onSwipeDelete, onLongPress, header, empty, refreshing, onRefresh }: Props) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const colW = Math.floor((width - PAD * 2 - GAP) / 2);
  const renderItem = useCallback(({ item, index }: { item: Post; index: number }) => (
    <View style={{ paddingLeft: index % 2 === 0 ? PAD : GAP / 2, paddingRight: index % 2 === 0 ? GAP / 2 : PAD }}>
      <PostCard post={item} width={colW} onPress={onPress} onSwipeDelete={onSwipeDelete} onLongPress={onLongPress} />
    </View>
  ), [colW, onPress, onSwipeDelete, onLongPress]);
  return (
    <FlashList
      data={posts}
      masonry
      optimizeItemArrangement
      numColumns={2}
      renderItem={renderItem}
      keyExtractor={keyOf}
      getItemType={typeOf}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      contentContainerStyle={{ paddingBottom: 120 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[c.accent]} progressBackgroundColor={c.elevated} /> : undefined}
    />
  );
}
