import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../theme';
import { t } from '../i18n';

export interface DialogPreview { image?: string | null; title: string; sub?: string }
export interface DialogButton { label: string; danger?: boolean; primary?: boolean; onPress?: () => void }
export interface ConfirmOpts { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean; icon?: any; preview?: DialogPreview }
export interface InfoOpts { title: string; message?: string; icon?: any; danger?: boolean; buttons?: DialogButton[] }

type State = { title: string; message?: string; icon?: any; danger?: boolean; preview?: DialogPreview; buttons: DialogButton[]; resolve?: (ok: boolean) => void } | null;

interface Api { confirm: (o: ConfirmOpts) => Promise<boolean>; info: (o: InfoOpts) => void }
const Ctx = createContext<Api>({ confirm: async () => false, info: () => {} });
export const useDialog = () => useContext(Ctx);

/** Custom in-app replacement for Alert.alert: themed bottom sheet with optional danger variant and post preview. */
export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [st, setSt] = useState<State>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => {
    setSt({
      title: o.title, message: o.message, icon: o.icon ?? (o.danger ? 'trash-outline' : undefined), danger: o.danger, preview: o.preview, resolve,
      buttons: [
        { label: o.confirmLabel || t('Готово'), danger: o.danger, primary: !o.danger },
        { label: o.cancelLabel || t('Отмена') },
      ],
    });
  }), []);
  const info = useCallback((o: InfoOpts) => {
    setSt({ title: o.title, message: o.message, icon: o.icon ?? (o.danger ? 'alert-circle-outline' : 'information-circle-outline'), danger: o.danger, buttons: o.buttons?.length ? o.buttons : [{ label: 'OK', primary: true }] });
  }, []);
  const close = (i: number | null) => {
    const s = st; setSt(null);
    if (!s) return;
    if (s.resolve) s.resolve(i === 0);
    else if (i != null) setTimeout(() => s.buttons[i]?.onPress?.(), 150);
  };
  return (
    <Ctx.Provider value={React.useMemo(() => ({ confirm, info }), [confirm, info])}>
      {children}
      <Sheet state={st} onClose={close} />
    </Ctx.Provider>
  );
}

function Sheet({ state, onClose }: { state: State; onClose: (i: number | null) => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(300)).current;
  const [shown, setShown] = useState<State>(null);
  useEffect(() => {
    if (state) { setShown(state); y.setValue(300); Animated.spring(y, { toValue: 0, useNativeDriver: true, isInteraction: false, bounciness: 3, speed: 18 }).start(); }
  }, [state, y]);
  const s = state || shown;
  if (!s) return null;
  const tint = s.danger ? c.danger : c.text;
  return (
    <Modal visible={!!state} transparent animationType="fade" onRequestClose={() => onClose(null)} statusBarTranslucent onDismiss={() => setShown(null)}>
      <Pressable style={[styles.backdrop, { backgroundColor: c.overlay }]} onPress={() => onClose(null)}>
        <Animated.View style={{ transform: [{ translateY: y }] }}>
          <Pressable style={[styles.sheet, { backgroundColor: c.elevated, paddingBottom: 18 + insets.bottom }]}>
            <View style={[styles.grabber, { backgroundColor: c.line }]} />
            {!!s.icon && <View style={[styles.icon, { backgroundColor: tint + '1F' }]}><Ionicons name={s.icon} size={28} color={tint} /></View>}
            <Text style={[styles.title, { color: c.text }]}>{s.title}</Text>
            {!!s.message && <Text style={[styles.msg, { color: c.sub }]}>{s.message}</Text>}
            {!!s.preview && (
              <View style={[styles.preview, { backgroundColor: c.card }]}>
                {s.preview.image ? <Image source={{ uri: s.preview.image }} style={styles.pImg} contentFit="cover" /> : <View style={[styles.pImg, { backgroundColor: c.line }]} />}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pTitle, { color: c.text }]} numberOfLines={2}>{s.preview.title}</Text>
                  {!!s.preview.sub && <Text style={[styles.pSub, { color: c.faint }]} numberOfLines={1}>{s.preview.sub}</Text>}
                </View>
              </View>
            )}
            {s.buttons.map((b, i) => {
              const bg = b.danger ? c.danger : b.primary ? c.text : c.card;
              const fg = b.danger ? '#FFFFFF' : b.primary ? c.bg : c.text;
              return (
                <Pressable key={i} onPress={() => onClose(i)} style={({ pressed }) => [styles.btn, { backgroundColor: bg, opacity: pressed ? 0.8 : 1 }]}>
                  <Text style={[styles.btnText, { color: fg }]}>{b.label}</Text>
                </Pressable>
              );
            })}
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 10, paddingHorizontal: 20 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 16 },
  icon: { alignSelf: 'center', width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 19, fontWeight: '800', textAlign: 'center' },
  msg: { fontSize: 14.5, lineHeight: 20, textAlign: 'center', marginTop: 6 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, marginTop: 16 },
  pImg: { width: 48, height: 48, borderRadius: 12 },
  pTitle: { fontSize: 14, fontWeight: '700' },
  pSub: { fontSize: 12, marginTop: 2 },
  btn: { height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  btnText: { fontSize: 16, fontWeight: '700' },
});
