import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Board, Post } from '../db';
import { activeCount, applyFilter, DEFAULT_FILTER, type FeedFilter, presentSources, type SourceKey, toggle } from '../core/filters';
import { useColors } from '../theme';
import { t } from '../i18n';
import { Chip, markLabel } from './common';

const MARK_ICON = { try: '🧪', done: '✅', skip: '💤' } as const;
export function sourceLabel(k: SourceKey): string {
  return k === 'instagram' ? 'Instagram' : k === 'tiktok' ? 'TikTok' : k === 'youtube' ? 'YouTube' : k === 'x' ? 'X' : k === 'shot' ? t('Скриншот') : t('Другое');
}

function useReduceMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (alive) setR(v); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setR);
    return () => { alive = false; sub.remove(); };
  }, []);
  return r;
}

/** «Фильтры» button with an active-count badge. */
export function FilterButton({ filter, onPress }: { filter: FeedFilter; onPress: () => void }) {
  const c = useColors();
  const n = activeCount(filter);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={n ? `${t('Фильтры')}: ${n}` : t('Фильтры')}
      style={({ pressed }) => [styles.fbtn, { backgroundColor: n ? c.chipActive : c.chip, opacity: pressed ? 0.8 : 1 }]}>
      <Ionicons name="options-outline" size={16} color={n ? c.onChipActive : c.text} />
      <Text style={[styles.fbtnText, { color: n ? c.onChipActive : c.text }]}>{t('Фильтры')}</Text>
      {n > 0 && <View style={[styles.badge, { backgroundColor: c.accent }]}><Text style={[styles.badgeText, { color: c.onAccent }]}>{n}</Text></View>}
    </Pressable>
  );
}

interface Props { visible: boolean; filter: FeedFilter; posts: Post[]; boards: Board[]; onApply: (f: FeedFilter) => void; onClose: () => void }

/** Bottom sheet with status / board / source / sort sections; edits a draft, «Показать N» applies it. */
export function FilterSheet({ visible, filter, posts, boards, onApply, onClose }: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const [draft, setDraft] = useState(filter);
  const y = useRef(new Animated.Value(600)).current;
  useEffect(() => {
    if (!visible) return;
    setDraft(filter);
    if (reduce) { y.setValue(0); return; }
    y.setValue(600);
    Animated.spring(y, { toValue: 0, useNativeDriver: true, bounciness: 3, speed: 18 }).start();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const sources = useMemo(() => presentSources(posts), [posts]);
  const count = useMemo(() => applyFilter(posts, draft, true).length, [posts, draft]);
  const usedBoards = boards.filter((b) => b.count == null || b.count > 0 || draft.boards.includes(b.id));
  const sec = (title: string) => <Text style={[styles.sec, { color: c.faint }]}>{title}</Text>;
  return (
    <Modal visible={visible} transparent animationType={reduce ? 'none' : 'fade'} onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: c.overlay }]} onPress={onClose} accessibilityLabel={t('Закрыть')}>
        <Animated.View style={{ transform: [{ translateY: y }], maxHeight: '85%' }}>
          <Pressable style={[styles.sheet, { backgroundColor: c.elevated, paddingBottom: 16 + insets.bottom }]}>
            <View style={[styles.grabber, { backgroundColor: c.line }]} />
            <Text style={[styles.title, { color: c.text }]}>{t('Фильтры')}</Text>
            <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>
              {sec(t('Статус'))}
              <View style={styles.wrap}>
                {(['try', 'done', 'skip'] as const).map((m) => (
                  <Chip key={m} label={`${MARK_ICON[m]} ${markLabel(m)}`} active={draft.marks.includes(m)} onPress={() => setDraft({ ...draft, marks: toggle(draft.marks, m) })} />
                ))}
              </View>
              {!draft.marks.length && <Text style={[styles.hint, { color: c.faint }]}>{t('Без отметки «Неважно» — пока её не выберешь')}</Text>}
              {usedBoards.length > 0 && <>{sec(t('Доска'))}
                <View style={styles.wrap}>
                  {usedBoards.map((b) => (
                    <Chip key={b.id} label={`${b.emoji ? b.emoji + ' ' : ''}${b.name}`} active={draft.boards.includes(b.id)} onPress={() => setDraft({ ...draft, boards: toggle(draft.boards, b.id) })} />
                  ))}
                </View></>}
              {sources.length > 1 && <>{sec(t('Источник'))}
                <View style={styles.wrap}>
                  {sources.map((k) => (
                    <Chip key={k} label={sourceLabel(k)} active={draft.sources.includes(k)} onPress={() => setDraft({ ...draft, sources: toggle(draft.sources, k) })} />
                  ))}
                </View></>}
              {sec(t('Сортировка'))}
              <View style={styles.wrap}>
                <Chip label={t('Сначала новые')} active={draft.sort === 'new'} onPress={() => setDraft({ ...draft, sort: 'new' })} />
                <Chip label={t('Сначала старые')} active={draft.sort === 'old'} onPress={() => setDraft({ ...draft, sort: 'old' })} />
              </View>
            </ScrollView>
            <View style={styles.btns}>
              <Pressable onPress={() => setDraft(DEFAULT_FILTER)} style={({ pressed }) => [styles.btn, { backgroundColor: c.card, opacity: pressed ? 0.8 : 1 }]}>
                <Text style={[styles.btnText, { color: c.text }]}>{t('Сбросить')}</Text>
              </Pressable>
              <Pressable onPress={() => onApply(draft)} disabled={count === 0} style={({ pressed }) => [styles.btn, { backgroundColor: c.accent, opacity: count === 0 ? 0.45 : pressed ? 0.8 : 1 }]}>
                <Text style={[styles.btnText, { color: c.onAccent }]}>{count === 0 ? t('Ничего нет') : t('Показать {n}', { n: count })}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fbtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18 },
  fbtnText: { fontSize: 14, fontWeight: '600' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 12, fontWeight: '800' },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 10, paddingHorizontal: 20 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  title: { fontSize: 19, fontWeight: '800' },
  sec: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 18, marginBottom: 10 },
  hint: { fontSize: 12.5, marginTop: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btns: { flexDirection: 'row', gap: 10, marginTop: 20 },
  btn: { flex: 1, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontWeight: '700' },
});
