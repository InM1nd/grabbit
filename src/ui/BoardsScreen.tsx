import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { GEMINI_MODELS } from '../core/ai';
import * as db from '../db';
import { hasApiKey } from '../processor';
import { C } from '../theme';
import { PromptModal } from './PromptModal';

interface Props {
  boards: db.Board[];
  unsortedCount: number;
  onOpenBoard: (id: number | null) => void;
  remindersOn: boolean;
  onToggleReminders: (on: boolean) => void;
  pendingCount: number;
  onRetry: () => void;
}

export function BoardsScreen({ boards, unsortedCount, onOpenBoard, remindersOn, onToggleReminders, pendingCount, onRetry }: Props) {
  const { width } = useWindowDimensions();
  const w = Math.floor((width - 24 - 12) / 2);
  const [renaming, setRenaming] = useState<db.Board | null>(null);
  const [creating, setCreating] = useState(false);

  const actions = (b: db.Board) => {
    Alert.alert(`${b.emoji ?? ''} ${b.name}`.trim(), `${b.count} сохранено`, [
      { text: 'Переименовать', onPress: () => setRenaming(b) },
      {
        text: 'Удалить доску', style: 'destructive',
        onPress: () => Alert.alert('Удалить доску?', 'Посты останутся в ленте, просто без доски.', [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Удалить', style: 'destructive', onPress: () => db.deleteBoard(b.id) },
        ]),
      },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 110 }}>
      <View style={styles.grid}>
        {boards.map((b) => (
          <Pressable key={b.id} onPress={() => onOpenBoard(b.id)} onLongPress={() => actions(b)} style={({ pressed }) => ({ width: w, opacity: pressed ? 0.85 : 1 })}>
            <Collage covers={b.covers} w={w} emoji={b.emoji} />
            <View style={styles.boardRow}>
              <Text style={styles.boardName} numberOfLines={1}>{b.emoji ? `${b.emoji} ` : ''}{b.name}</Text>
              <Pressable hitSlop={10} onPress={() => actions(b)}><Ionicons name="ellipsis-horizontal" size={16} color={C.faint} /></Pressable>
            </View>
            <Text style={styles.count}>{b.count} {plural(b.count)}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setCreating(true)} style={[styles.newBoard, { width: w, height: w * 0.75 }]}>
          <Ionicons name="add" size={28} color={C.sub} />
          <Text style={{ color: C.sub, marginTop: 4 }}>Новая доска</Text>
        </Pressable>
      </View>
      {unsortedCount > 0 && (
        <Text style={styles.note}>Без доски: {unsortedCount} — они в общей ленте.</Text>
      )}

      <View style={styles.settings}>
        <Text style={styles.sectionTitle}>Настройки</Text>
        <View style={styles.setRow}>
          <Ionicons name="notifications-outline" size={20} color={C.text} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.setTitle}>Напоминания о забытом</Text>
            <Text style={styles.setSub}>Раз в пару дней вечером — про пост, который ты сохранил неделю назад и не открыл</Text>
          </View>
          <Switch value={remindersOn} onValueChange={onToggleReminders} trackColor={{ true: C.accent }} thumbColor="#fff" />
        </View>
        <View style={styles.setRow}>
          <Ionicons name="sparkles-outline" size={20} color={C.text} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.setTitle}>ИИ-описания: Gemini</Text>
            <Text style={styles.setSub}>
              {hasApiKey() ? `${GEMINI_MODELS[0]} (запасная: ${GEMINI_MODELS[1]})` : 'Ключ не найден в сборке'}
              {pendingCount ? `\nВ очереди: ${pendingCount} — обработаются, когда будет сеть` : '\nОчередь пуста'}
            </Text>
          </View>
          {pendingCount > 0 && (
            <Pressable onPress={onRetry} style={styles.smallBtn}><Text style={styles.smallBtnText}>Повторить</Text></Pressable>
          )}
        </View>
      </View>

      <PromptModal
        visible={!!renaming}
        title="Переименовать доску"
        initial={renaming?.name}
        hint="Если такая доска уже есть, они объединятся."
        onCancel={() => setRenaming(null)}
        onOk={async (v) => { if (renaming) await db.renameBoard(renaming.id, v); setRenaming(null); }}
      />
      <PromptModal
        visible={creating}
        title="Новая доска"
        placeholder="Например: UI-идеи"
        hint="ИИ будет класть сюда подходящие посты."
        onCancel={() => setCreating(false)}
        onOk={async (v) => { await db.getOrCreateBoard(v); setCreating(false); }}
      />
    </ScrollView>
  );
}

function plural(n: number) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'пост';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'поста';
  return 'постов';
}

function Collage({ covers, w, emoji }: { covers: string[]; w: number; emoji: string | null }) {
  const h = w * 0.75;
  if (!covers.length) {
    return <View style={[styles.collage, { height: h, alignItems: 'center', justifyContent: 'center' }]}><Text style={{ fontSize: 36 }}>{emoji || '📌'}</Text></View>;
  }
  if (covers.length < 3) {
    return <Image source={{ uri: covers[0] }} style={[styles.collage, { height: h }]} contentFit="cover" />;
  }
  return (
    <View style={[styles.collage, { height: h, flexDirection: 'row' }]}>
      <Image source={{ uri: covers[0] }} style={{ width: w * 0.62, height: h }} contentFit="cover" />
      <View style={{ flex: 1, marginLeft: 2 }}>
        <Image source={{ uri: covers[1] }} style={{ flex: 1 }} contentFit="cover" />
        <Image source={{ uri: covers[2] }} style={{ flex: 1, marginTop: 2 }} contentFit="cover" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 16 },
  collage: { borderRadius: 16, overflow: 'hidden', backgroundColor: C.chip, width: '100%' },
  boardRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingHorizontal: 2 },
  boardName: { flex: 1, fontSize: 15, fontWeight: '700', color: C.text },
  count: { fontSize: 12, color: C.faint, paddingHorizontal: 2, marginTop: 2 },
  newBoard: { borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  note: { color: C.faint, fontSize: 12, marginTop: 14, textAlign: 'center' },
  settings: { marginTop: 28, backgroundColor: C.card, borderRadius: 16, padding: 14 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: C.faint, textTransform: 'uppercase', marginBottom: 6 },
  setRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  setTitle: { fontSize: 15, color: C.text, fontWeight: '500' },
  setSub: { fontSize: 12.5, color: C.sub, marginTop: 2, lineHeight: 17 },
  smallBtn: { backgroundColor: C.accentSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  smallBtnText: { color: C.accent, fontWeight: '600', fontSize: 13 },
});
