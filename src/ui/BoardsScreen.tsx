import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as db from '../db';
import { useColors } from '../theme';
import { ActionSheet, PromptModal } from './common';
import { t } from '../i18n';

interface Props { boards: db.Board[]; unsortedCount: number; onOpenBoard: (id: number | null) => void }

export function BoardsScreen({ boards, unsortedCount, onOpenBoard }: Props) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const w = Math.floor((width - 28 - 14) / 2);
  const [menu, setMenu] = useState<db.Board | null>(null);
  const [renaming, setRenaming] = useState<db.Board | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 4, paddingBottom: 120 }}>
      <View style={styles.grid}>
        {boards.map((b) => (
          <Pressable key={b.id} onPress={() => onOpenBoard(b.id)} onLongPress={() => setMenu(b)} style={({ pressed }) => ({ width: w, opacity: pressed ? 0.8 : 1 })}>
            <Cover covers={b.covers} w={w} emoji={b.emoji} />
            <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>{b.name}</Text>
            <Text style={[styles.count, { color: c.faint }]}>{b.count}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setCreating(true)} style={[styles.newBoard, { width: w, height: w, borderColor: c.line }]}>
          <Ionicons name="add" size={26} color={c.faint} />
          <Text style={{ color: c.faint, marginTop: 4 }}>{t('Новая доска')}</Text>
        </Pressable>
      </View>
      {unsortedCount > 0 && <Text style={[styles.note, { color: c.faint }]}>{t('Без доски: {n}', { n: unsortedCount })}</Text>}
      <Text style={[styles.note, { color: c.faint }]}>{t('Долгое нажатие — переименовать или удалить')}</Text>

      <ActionSheet
        visible={!!menu}
        title={menu ? `${menu.emoji ?? ''} ${menu.name}`.trim() : ''}
        onClose={() => setMenu(null)}
        actions={menu ? [
          { label: t('Переименовать'), icon: 'create-outline', onPress: () => setRenaming(menu) },
          {
            label: t('Удалить доску'), icon: 'trash-outline', destructive: true,
            onPress: () => Alert.alert(t('Удалить доску?'), t('Посты останутся в ленте, просто без доски.'), [
              { text: t('Отмена'), style: 'cancel' },
              { text: t('Удалить'), style: 'destructive', onPress: () => db.deleteBoard(menu.id) },
            ]),
          },
        ] : []}
      />
      <PromptModal visible={!!renaming} title={t('Переименовать доску')} initial={renaming?.name} hint={t('Если такая доска уже есть, они объединятся.')}
        onCancel={() => setRenaming(null)} onOk={async (v) => { if (renaming) await db.renameBoard(renaming.id, v); setRenaming(null); }} />
      <PromptModal visible={creating} title={t('Новая доска')} placeholder={t('Например: UI-идеи')} hint={t('ИИ будет класть сюда подходящие посты.')}
        onCancel={() => setCreating(false)} onOk={async (v) => { await db.getOrCreateBoard(v); setCreating(false); }} />
    </ScrollView>
  );
}

function Cover({ covers, w, emoji }: { covers: string[]; w: number; emoji: string | null }) {
  const c = useColors();
  const base = { width: w, height: w, borderRadius: 18, overflow: 'hidden' as const, backgroundColor: c.card };
  if (!covers.length) return <View style={[base, { alignItems: 'center', justifyContent: 'center' }]}><Text style={{ fontSize: 34 }}>{emoji || '📌'}</Text></View>;
  if (covers.length < 3) return <Image source={{ uri: covers[0] }} style={base} contentFit="cover" />;
  return (
    <View style={[base, { flexDirection: 'row' }]}>
      <Image source={{ uri: covers[0] }} style={{ width: w * 0.62, height: w }} contentFit="cover" />
      <View style={{ flex: 1, marginLeft: 2 }}>
        <Image source={{ uri: covers[1] }} style={{ flex: 1 }} contentFit="cover" />
        <Image source={{ uri: covers[2] }} style={{ flex: 1, marginTop: 2 }} contentFit="cover" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 18 },
  name: { fontSize: 15, fontWeight: '600', marginTop: 8 },
  count: { fontSize: 13, marginTop: 1 },
  newBoard: { borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 12.5, marginTop: 16, textAlign: 'center' },
});
