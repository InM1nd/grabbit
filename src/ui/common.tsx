import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, KeyboardAvoidingView, Platform, Modal, Pressable, StyleSheet, Text, TextInput, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../theme';
import { t } from '../i18n';

export function IconBtn({ name, onPress, size = 22, color, label }: { name: any; onPress: () => void; size?: number; color?: string; label?: string }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityLabel={label} style={({ pressed }) => ({ padding: 8, borderRadius: 20, opacity: pressed ? 0.5 : 1 })}>
      <Ionicons name={name} size={size} color={color || c.text} />
    </Pressable>
  );
}

// ---------- motion ----------

const HAPTIC = { confirm: Haptics.AndroidHaptics.Confirm, reject: Haptics.AndroidHaptics.Reject, 'toggle-on': Haptics.AndroidHaptics.Toggle_On, 'toggle-off': Haptics.AndroidHaptics.Toggle_Off } as const;
/** Short system haptic. Android only (the app ships for Android); performHapticFeedback needs no VIBRATE permission. */
export function haptic(kind: keyof typeof HAPTIC): void {
  if (Platform.OS !== 'android') return;
  Haptics.performAndroidHapticsAsync(HAPTIC[kind]).catch(() => {});
}

/** System «reduce motion» setting; animations below collapse to instant changes when it is on. */
let reduceMotion = false;
const reduceSubs = new Set<(v: boolean) => void>();
void AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduceMotion = v; reduceSubs.forEach((f) => f(v)); }).catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => { reduceMotion = v; reduceSubs.forEach((f) => f(v)); });
// one listener for the whole app: every feed card uses this hook
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(reduceMotion);
  useEffect(() => { reduceSubs.add(setReduce); return () => { reduceSubs.delete(setReduce); }; }, []);
  return reduce;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressable that sinks a little under the finger and springs back. */
export function PressScale({ style, scaleTo = 0.95, onPressIn, onPressOut, ...rest }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: true, isInteraction: false, speed: 40, bounciness: v === 1 ? 10 : 0 }).start();
  return <AnimatedPressable {...rest} style={[style, { transform: [{ scale }] }]}
    onPressIn={(e) => { if (!reduce) to(scaleTo); onPressIn?.(e); }}
    onPressOut={(e) => { to(1); onPressOut?.(e); }} />;
}

/** Icon that pops (grows and settles) each time it becomes active. */
export function PopIcon({ active, ...icon }: React.ComponentProps<typeof Ionicons> & { active: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduce = useReduceMotion();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!active || reduce) return;
    scale.setValue(0.6);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, isInteraction: false, speed: 14, bounciness: 16 }).start();
  }, [active]);
  return <Animated.View style={{ transform: [{ scale }] }}><Ionicons {...icon} /></Animated.View>;
}

/** Fades and slides its content in once, when it mounts. */
export function Appear({ children, style, delay = 0, dy = 8 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; delay?: number; dy?: number }) {
  const p = useRef(new Animated.Value(0)).current;
  const reduce = useReduceMotion();
  useEffect(() => { Animated.timing(p, { toValue: 1, duration: reduce ? 0 : 220, delay: reduce ? 0 : delay, useNativeDriver: true, isInteraction: false }).start(); }, []);
  return <Animated.View style={[style, { opacity: p, transform: [{ translateY: p.interpolate({ inputRange: [0, 1], outputRange: [dy, 0] }) }] }]}>{children}</Animated.View>;
}

export function Chip({ label, active, icon, onPress, onLongPress }: { label: string; active?: boolean; icon?: React.ComponentProps<typeof Ionicons>['name']; onPress?: () => void; onLongPress?: () => void }) {
  const c = useColors();
  return (
    <PressScale onPress={onPress} onLongPress={onLongPress} style={[styles.chip, { backgroundColor: active ? c.chipActive : c.chip }, !!icon && styles.chipWithIcon]}>
      {!!icon && <PopIcon active={!!active} name={icon} size={15} color={active ? c.onChipActive : c.sub} />}
      <Text numberOfLines={1} style={[styles.chipText, { color: active ? c.onChipActive : c.text }]}>{label}</Text>
    </PressScale>
  );
}

export interface SheetAction { label: string; icon?: any; destructive?: boolean; onPress: () => void }

/** Bottom action sheet (Android Alert can only show 3 buttons). */
export function ActionSheet({ visible, title, actions, onClose }: { visible: boolean; title?: string; actions: SheetAction[]; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: c.overlay }]} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.elevated, paddingBottom: 12 + insets.bottom }]}>
          <View style={[styles.grabber, { backgroundColor: c.line }]} />
          {!!title && <Text style={[styles.sheetTitle, { color: c.sub }]} numberOfLines={2}>{title}</Text>}
          {actions.map((a) => (
            <Pressable key={a.label} onPress={() => { onClose(); setTimeout(a.onPress, 120); }} style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.card }]}>
              {a.icon && <Ionicons name={a.icon} size={20} color={a.destructive ? c.danger : c.text} style={{ width: 28 }} />}
              <Text style={[styles.rowText, { color: a.destructive ? c.danger : c.text }]}>{a.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

interface PromptProps {
  visible: boolean; title: string; placeholder?: string; initial?: string; okLabel?: string; hint?: string; multiline?: boolean;
  onCancel: () => void; onOk: (value: string) => void;
}

export function PromptModal({ visible, title, placeholder, initial = '', okLabel = t('Готово'), hint, multiline, onCancel, onOk }: PromptProps) {
  const c = useColors();
  const [v, setV] = useState(initial);
  useEffect(() => { if (visible) setV(initial); }, [visible, initial]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={[styles.center, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={[styles.box, { backgroundColor: c.elevated }]}>
          <Text style={[styles.boxTitle, { color: c.text }]}>{title}</Text>
          {!!hint && <Text style={[styles.hint, { color: c.sub }]}>{hint}</Text>}
          <TextInput
            value={v} onChangeText={setV} placeholder={placeholder} placeholderTextColor={c.faint} autoFocus multiline={multiline}
            style={[styles.input, { color: c.text, borderColor: c.line, backgroundColor: c.bg }, multiline && { minHeight: 90, textAlignVertical: 'top' }]}
            onSubmitEditing={() => !multiline && v.trim() && onOk(v.trim())}
          />
          <View style={styles.btns}>
            <Pressable onPress={onCancel} style={styles.btn}><Text style={{ color: c.sub, fontSize: 15, fontWeight: '500' }}>{t('Отмена')}</Text></Pressable>
            <Pressable onPress={() => v.trim() && onOk(v.trim())} style={[styles.btn, { backgroundColor: c.text, opacity: v.trim() ? 1 : 0.4 }]}>
              <Text style={{ color: c.bg, fontSize: 15, fontWeight: '600' }}>{okLabel}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chip: { borderRadius: 18, paddingHorizontal: 14, height: 34, justifyContent: 'center', maxWidth: 220 },
  chipWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 14, fontWeight: '500' },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8, paddingHorizontal: 8 },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 8 },
  sheetTitle: { fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12 },
  rowText: { fontSize: 16 },
  center: { flex: 1, justifyContent: 'center', padding: 24 },
  box: { borderRadius: 20, padding: 20 },
  boxTitle: { fontSize: 17, fontWeight: '700' },
  hint: { fontSize: 13, marginTop: 6, lineHeight: 18 },
  input: { marginTop: 14, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  btns: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16, gap: 8 },
  btn: { paddingHorizontal: 16, height: 40, borderRadius: 12, justifyContent: 'center' },
});

/** Status icons: the same outline set in filters, the post sheet and the long-press menu (cards use MARK_GLYPH badges). */
export const MARK_ICON = { try: 'flask-outline', done: 'checkmark-circle-outline', skip: 'moon-outline' } as const;
export const MARK_GLYPH = { try: 'flask', done: 'checkmark', skip: 'moon' } as const;
export const MARK_COLOR = { try: '#F59E0B', done: '#16A34A', skip: '#71717A' } as const;
export function markLabel(m: 'try' | 'done' | 'skip'): string {
  return m === 'try' ? t('Попробовать') : m === 'done' ? t('Сделано') : t('Неважно');
}
