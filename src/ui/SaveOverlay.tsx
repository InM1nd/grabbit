import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as db from '../db';
import { onDataChanged } from '../events';
import { useColors } from '../theme';
import { t } from '../i18n';
import { haptic, useReduceMotion } from './common';
import { SaveRabbit } from './SaveRabbit';

export type SaveState = { kind: 'saved' | 'duplicate'; id: number } | { kind: 'no-url' } | null;

interface Props { state: SaveState; delaySec: number; onDone: () => void; onOpen: (id: number) => void }

/** Confirm local storage while the queue handles the post. */
export function SaveOverlay({ state, delaySec, onDone, onOpen }: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [details, setDetails] = useState<{ state: SaveState; label: string | null; status: db.PostStatus } | null>(null);
  const [y] = useState(() => new Animated.Value(120));
  const doneRef = useRef(onDone);
  useLayoutEffect(() => { doneRef.current = onDone; }, [onDone]);

  useEffect(() => {
    if (!state) return;
    haptic(state.kind === 'no-url' ? 'reject' : 'confirm');
    const ms = state.kind === 'no-url' ? 2500 : delaySec < 0 ? 2600 : Math.max(700, delaySec * 1000);
    const t = setTimeout(() => doneRef.current(), ms);
    if (state.kind === 'no-url') return () => clearTimeout(t);
    let alive = true;
    const load = async () => {
      const p = await db.getPost(state.id);
      if (!alive || !p) return;
      const board = p.boardId == null ? null : (await db.listBoards()).find((b) => b.id === p.boardId);
      if (alive) setDetails({ state, label: board ? [board.emoji, board.name].filter(Boolean).join(' ') : null, status: p.status });
    };
    const refresh = () => { void load().catch(() => {}); };
    refresh();
    const off = onDataChanged(refresh);
    return () => { alive = false; off(); clearTimeout(t); };
  }, [state, delaySec]);

  useEffect(() => {
    if (!state) return;
    y.setValue(reduceMotion ? 0 : 120);
    if (reduceMotion) return;
    const entry = Animated.spring(y, { toValue: 0, useNativeDriver: true, isInteraction: false, bounciness: 5 });
    entry.start();
    return () => entry.stop();
  }, [state, y, reduceMotion]);

  if (!state) return null;
  const text = state.kind === 'no-url' ? t('В сообщении нет ссылки') : state.kind === 'duplicate' ? t('Уже сохранено') : t('Сохранено');
  const current = details?.state === state ? details : null;
  const sub = current?.label ?? (state.kind === 'saved' && (!current || current.status === 'pending') ? t('Описание готовится') : null);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.pill, { bottom: 104 + insets.bottom, backgroundColor: c.elevated, borderColor: c.line, transform: [{ translateY: y }] }]}>
        {state.kind === 'saved' ? <SaveRabbit key={state.id} compact /> : (
          <Ionicons name={state.kind === 'no-url' ? 'alert-circle' : 'checkmark-circle'} size={20} color={state.kind === 'no-url' ? c.warn : c.accent} />
        )}
        <View style={styles.copy} accessibilityLiveRegion="polite">
          <Text style={[styles.text, { color: c.text }]}>{text}</Text>
          {sub && <Text style={[styles.subtitle, { color: c.sub }]} numberOfLines={1}>{sub}</Text>}
        </View>
        {state.kind !== 'no-url' && (
          <Pressable accessibilityRole="button" onPress={() => onOpen(state.id)} hitSlop={10} style={{ marginLeft: 'auto', paddingLeft: 12 }}>
            <Text style={[styles.link, { color: c.text }]}>{t('Открыть пост')}</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, minHeight: 58, paddingVertical: 9, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12 },
  copy: { flex: 1, marginLeft: 10, gap: 2 },
  text: { fontSize: 15, fontWeight: '700' },
  subtitle: { fontSize: 12 },
  link: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline', opacity: 0.85 },
});
