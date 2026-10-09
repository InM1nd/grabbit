import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import * as db from '../db';
import { onDataChanged } from '../events';
import { C } from '../theme';

export type SaveState = { kind: 'saved' | 'duplicate'; id: number } | { kind: 'no-url' } | null;

interface Props { state: SaveState; onDone: () => void; onOpen: (id: number) => void }

/** Small bottom sheet shown after a share: "Сохранено ✓" + live AI result, then auto-returns. */
export function SaveOverlay({ state, onDone, onOpen }: Props) {
  const [post, setPost] = useState<db.Post | null>(null);
  const [boardName, setBoardName] = useState<string | null>(null);
  const y = useRef(new Animated.Value(200)).current;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!state) return;
    y.setValue(200);
    Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
    if (state.kind === 'no-url') {
      const t = setTimeout(() => doneRef.current(), 2500);
      return () => clearTimeout(t);
    }
    let alive = true;
    let closeTimer: ReturnType<typeof setTimeout> | null = null;
    const load = async () => {
      const p = await db.getPost(state.id);
      if (!alive || !p) return;
      setPost(p);
      if (p.boardId) {
        const b = (await db.listBoards()).find((x) => x.id === p.boardId);
        if (alive && b) setBoardName(`${b.emoji ?? '📌'} ${b.name}`);
      }
      if ((p.status !== 'pending' || state.kind === 'duplicate') && !closeTimer) {
        closeTimer = setTimeout(() => doneRef.current(), state.kind === 'duplicate' ? 2200 : 1800);
      }
    };
    load();
    const off = onDataChanged(load);
    // never hold the user longer than ~9s: the AI step continues in the queue
    const hard = setTimeout(() => doneRef.current(), 9000);
    return () => { alive = false; off(); clearTimeout(hard); if (closeTimer) clearTimeout(closeTimer); };
  }, [state]);

  if (!state) return null;
  const img = post?.localImage || post?.image;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]} onPress={onDone} />
      <Animated.View style={[styles.sheet, { transform: [{ translateY: y }] }]}>
        {state.kind === 'no-url' ? (
          <View style={styles.row}>
            <Ionicons name="alert-circle" size={28} color={C.warn} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={styles.title}>Не нашёл ссылку</Text>
              <Text style={styles.sub}>Поделись именно постом — так, чтобы в тексте была ссылка.</Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.row}>
              {img ? <Image source={{ uri: img }} style={styles.thumb} contentFit="cover" /> : <Ionicons name="checkmark-circle" size={34} color={C.ok} />}
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.title}>{state.kind === 'duplicate' ? 'Уже на полке' : 'Сохранено ✓'}</Text>
                {post?.status === 'pending' ? (
                  <View style={[styles.row, { marginTop: 4 }]}>
                    <ActivityIndicator size="small" color={C.accent} />
                    <Text style={[styles.sub, { marginLeft: 6, marginTop: 0 }]}>ИИ разбирает пост…</Text>
                  </View>
                ) : (
                  <Text style={styles.sub} numberOfLines={2}>
                    {post?.aiTitle || post?.title || ''}{boardName ? `\n→ ${boardName}` : ''}
                  </Text>
                )}
              </View>
            </View>
            <View style={styles.btns}>
              <Pressable onPress={() => onOpen(state.id)} style={styles.btnGhost}><Text style={styles.btnGhostText}>Открыть</Text></Pressable>
              <Pressable onPress={onDone} style={styles.btn}><Text style={styles.btnText}>Готово</Text></Pressable>
            </View>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { position: 'absolute', left: 12, right: 12, bottom: 28, backgroundColor: C.card, borderRadius: 22, padding: 16, elevation: 8, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 16 },
  row: { flexDirection: 'row', alignItems: 'center' },
  thumb: { width: 54, height: 54, borderRadius: 12, backgroundColor: C.chip },
  title: { fontSize: 17, fontWeight: '700', color: C.text },
  sub: { fontSize: 13.5, color: C.sub, marginTop: 3, lineHeight: 18 },
  btns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  btn: { backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 18, height: 40, justifyContent: 'center' },
  btnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  btnGhost: { borderRadius: 12, paddingHorizontal: 14, height: 40, justifyContent: 'center' },
  btnGhostText: { color: C.sub, fontWeight: '500', fontSize: 15 },
});
