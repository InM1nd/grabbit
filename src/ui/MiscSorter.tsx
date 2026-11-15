import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Post } from '../db';
import type { ResortProgress, ResortResult } from '../processor';
import { useColors } from '../theme';
import { t } from '../i18n';

/** In-feed card on the Misc board: «Разобрать Misc» with inline progress (no system dialogs). */
export function MiscSorter({ posts, onSort, onDone }: {
  posts: Post[]; onSort: (onProgress: (p: ResortProgress) => void) => Promise<ResortResult>; onDone: (msg: string, r?: ResortResult) => void;
}) {
  const c = useColors();
  const [prog, setProg] = useState<ResortProgress | null>(null);
  const running = useRef(false);
  const waiting = posts.filter((p) => p.needsResort).length;
  const sortable = posts.filter(p => p.status !== 'pending').length;
  if (!posts.length) return null;

  const run = async () => {
    if (running.current) return;
    running.current = true;
    setProg({ done: 0, total: sortable, moved: 0 });
    let r: ResortResult | null = null;
    try { r = await onSort(setProg); } catch { /* reported below */ }
    running.current = false;
    setProg(null);
    if (!r) return onDone(t('Не удалось разобрать — попробуй позже'));
    const parts = [r.moved ? t('Разложил по доскам: {n}', { n: r.moved }) : t('Новых мест не нашлось')];
    if (r.noAi) return onDone(t('Нет ключа Gemini в сборке'));
    if (r.waiting) parts.push(t('Недостаточно данных: {n}', { n: r.waiting }));
    if (r.limited) parts.push(t('Достигнут лимит ИИ'));
    else if (r.left) parts.push(t('ещё {n} — нажми снова', { n: r.left }));
    onDone(parts.join(' · '), r);
  };

  const pct = prog && prog.total ? Math.min(1, prog.done / prog.total) : 0;
  return (
    <View style={[styles.card, { backgroundColor: c.card }]}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: c.accentSoft }]}><Ionicons name="sparkles" size={18} color={c.accent} /></View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.text }]}>{prog ? t('Разбираю Misc…') : t('Разобрать Misc')}</Text>
          <Text style={[styles.sub, { color: c.sub }]} numberOfLines={2}>
            {prog
              ? t('Проверено {done} из {total} · перенесено {moved}', { done: prog.done, total: prog.total, moved: prog.moved })
              : sortable
                ? t('Перечитать слабые посты и разложить по доскам')
                : t('Посты ещё обрабатываются')}
          </Text>
        </View>
        {prog ? <ActivityIndicator color={c.accent} /> : sortable > 0 && (
          <Pressable onPress={run} accessibilityRole="button" accessibilityLabel={t('Распределить по доскам')}
            style={({ pressed }) => [styles.btn, { backgroundColor: c.chipActive, opacity: pressed ? 0.8 : 1 }]}>
            <Text style={[styles.btnText, { color: c.onChipActive }]}>{t('Распределить')}</Text>
          </Pressable>
        )}
      </View>
      {!!prog && <View style={[styles.track, { backgroundColor: c.chip }]}><View style={[styles.fill, { backgroundColor: c.accent, width: `${Math.round(pct * 100)}%` }]} /></View>}
      {waiting > 0 && !prog && (
        <Text style={[styles.note, { color: c.faint }]}>{t('Закрытых постов: {n} — добавь скриншот или заметку, и они разложатся сами', { n: waiting })}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 4, marginBottom: 10, padding: 12, borderRadius: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 12.5, marginTop: 2 },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  btnText: { fontSize: 13, fontWeight: '700' },
  track: { height: 4, borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  note: { fontSize: 12, marginTop: 8 },
});
