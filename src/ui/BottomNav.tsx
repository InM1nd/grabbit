import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../i18n';
import { useColors } from '../theme';

type Tab = 'feed' | 'boards';
interface Props { tab: Tab; onChange: (tab: Tab) => void; onAdd: () => void; bottomInset?: number }

/** Floating navigation; the central save action stays in the same place on both tabs. */
export function BottomNav({ tab, onChange, onAdd, bottomInset = 0 }: Props) {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const [position] = useState(() => new Animated.Value(tab === 'feed' ? 0 : 1));
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (alive) setReduceMotion(value); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { alive = false; sub.remove(); };
  }, []);
  useEffect(() => {
    const animation = Animated.timing(position, {
      toValue: tab === 'feed' ? 0 : 1,
      duration: reduceMotion ? 0 : 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [position, reduceMotion, tab]);

  // 1px border, 8px padding, 56px save button, two 8px gaps.
  const tabWidth = Math.max(0, (width - 90) / 2);
  const renderTab = (value: Tab) => {
    const active = tab === value;
    const label = value === 'feed' ? t('Лента') : t('Доски');
    return <Pressable accessibilityRole="tab" aria-selected={active} accessibilityLabel={label}
      onPress={() => onChange(value)} style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.65 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <Ionicons name={value === 'feed' ? (active ? 'grid' : 'grid-outline') : (active ? 'albums' : 'albums-outline')} size={21} color={active ? c.accent : c.sub} />
      <Text style={[styles.label, { color: active ? c.text : c.sub, fontWeight: active ? '700' : '500' }]}>{label}</Text>
    </Pressable>;
  };

  return <View pointerEvents="box-none" style={[styles.anchor, { bottom: Math.max(12, bottomInset) }]}>
    <View accessibilityRole="tablist" onLayout={event => setWidth(event.nativeEvent.layout.width)}
      style={[styles.dock, { backgroundColor: c.dark ? c.elevated : '#FFFFFF', borderColor: c.dark ? '#343438' : '#EDEDEF', shadowOpacity: c.dark ? 0.35 : 0.12 }]}>
      {width > 0 && <Animated.View pointerEvents="none" style={[styles.indicator, { width: tabWidth, backgroundColor: c.accentSoft,
        transform: [{ translateX: position.interpolate({ inputRange: [0, 1], outputRange: [0, tabWidth + 72] }) }] }]} />}
      {renderTab('feed')}
      <Pressable accessibilityRole="button" accessibilityLabel={t('Добавить ссылку')} onPress={onAdd}
        style={({ pressed }) => [styles.add, { transform: [{ scale: pressed ? 0.91 : 1 }], backgroundColor: pressed ? '#DE3E35' : '#F8483E' }]}>
        <Ionicons name="add" size={30} color="#FFFFFF" />
      </Pressable>
      {renderTab('boards')}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  dock: { width: '100%', maxWidth: 440, height: 74, padding: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 38,
    borderWidth: 1, shadowColor: '#111116', shadowOffset: { width: 0, height: 8 }, shadowRadius: 22, elevation: 12 },
  indicator: { position: 'absolute', top: 9, left: 9, height: 56, borderRadius: 28 },
  tab: { flex: 1, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  label: { fontSize: 13 },
  add: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', shadowColor: '#F8483E', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.22, shadowRadius: 8, elevation: 3 },
});
