import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as db from '../db';
import { onDataChanged } from '../events';
import { useColors } from '../theme';
import { t } from '../i18n';

export type SaveState = { kind: 'saved' | 'duplicate'; id: number } | { kind: 'no-url' } | null;

interface Props { state: SaveState; delaySec: number; onDone: () => void; onOpen: (id: number) => void }

/** One-line pill after a share: «Сохранено → 🤖 Board · Изменить», then auto-return. */
export function SaveOverlay({ state, delaySec, onDone, onOpen }: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [label, setLabel] = useState<string | null>(null);
  const [pending, setPending] = useState(true);
  const y = useRef(new Animated.Value(120)).current;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!state) return;
    setLabel(null); setPending(state.kind === 'saved');
    y.setValue(120);
    Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 5 }).start();
    const ms = state.kind === 'no-url' ? 2500 : delaySec < 0 ? 2600 : Math.max(700, delaySec * 1000);
    const t = setTimeout(() => doneRef.current(), ms);
    if (state.kind === 'no-url') return () => clearTimeout(t);
    let alive = true;
    const load = async () => {
      const p = await db.getPost(state.id);
      if (!alive || !p) return;
      setPending(p.status === 'pending');
      if (p.boardId) {
        const b = (await db.listBoards()).find((x) => x.id === p.boardId);
        if (alive && b) setLabel(`${b.emoji ?? '📌'} ${b.name}`);
      }
    };
    load();
    const off = onDataChanged(load);
    return () => { alive = false; off(); clearTimeout(t); };
  }, [state]);

  if (!state) return null;
  const text = state.kind === 'no-url' ? t('В сообщении нет ссылки') : state.kind === 'duplicate' ? t('Уже сохранено') : t('Сохранено');
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.pill, { bottom: 104 + insets.bottom, backgroundColor: c.elevated, borderColor: c.line, transform: [{ translateY: y }] }]}>
        <Ionicons name={state.kind === 'no-url' ? 'alert-circle' : 'checkmark-circle'} size={20} color={state.kind === 'no-url' ? c.warn : c.accent} />
        <Text style={[styles.text, { color: c.text }]} numberOfLines={1}>
          {text}{label ? ` → ${label}` : ''}
        </Text>
        {state.kind !== 'no-url' && pending && !label && <ActivityIndicator size="small" color={c.bg} style={{ marginLeft: 6 }} />}
        {state.kind !== 'no-url' && (
          <Pressable onPress={() => onOpen(state.id)} hitSlop={10} style={{ marginLeft: 'auto', paddingLeft: 12 }}>
            <Text style={[styles.link, { color: c.text }]}>{t('Изменить')}</Text>
          </Pressable>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, height: 52, elevation: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12 },
  text: { marginLeft: 10, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  link: { fontSize: 14.5, fontWeight: '600', textDecorationLine: 'underline', opacity: 0.85 },
});
