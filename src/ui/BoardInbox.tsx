import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { useColors } from '../theme';

export function BoardInbox({ count, onPress }: { count: number; onPress: () => void }) {
  const c = useColors();
  return <Pressable accessibilityRole="button" onPress={onPress}
    style={({ pressed }) => [styles.row, { backgroundColor: c.card, opacity: pressed ? 0.75 : 1 }]}>
    <View style={[styles.icon, { backgroundColor: c.accentSoft }]}>
      <Ionicons name="file-tray-outline" size={23} color={c.accent} />
    </View>
    <View style={styles.copy}>
      <Text style={[styles.title, { color: c.text }]}>{t('Входящие')}</Text>
      <Text style={{ color: c.sub, fontSize: 13 }}>{t('Посты без доски')}</Text>
    </View>
    <Text style={{ color: c.sub }}>{count}</Text>
    <Ionicons name="chevron-forward" size={17} color={c.sub} />
  </Pressable>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, marginBottom: 18 },
  icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '700' },
});
