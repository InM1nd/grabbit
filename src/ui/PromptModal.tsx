import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { C } from '../theme';

interface Props {
  visible: boolean;
  title: string;
  placeholder?: string;
  initial?: string;
  okLabel?: string;
  hint?: string;
  multiline?: boolean;
  onCancel: () => void;
  onOk: (value: string) => void;
}

export function PromptModal({ visible, title, placeholder, initial = '', okLabel = 'Готово', hint, multiline, onCancel, onOk }: Props) {
  const [v, setV] = useState(initial);
  useEffect(() => { if (visible) setV(initial); }, [visible, initial]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.box}>
          <Text style={styles.title}>{title}</Text>
          {!!hint && <Text style={styles.hint}>{hint}</Text>}
          <TextInput
            value={v}
            onChangeText={setV}
            placeholder={placeholder}
            placeholderTextColor={C.faint}
            autoFocus
            multiline={multiline}
            style={[styles.input, multiline && { minHeight: 80, textAlignVertical: 'top' }]}
            onSubmitEditing={() => !multiline && v.trim() && onOk(v.trim())}
          />
          <View style={styles.row}>
            <Pressable onPress={onCancel} style={styles.btn}><Text style={styles.cancel}>Отмена</Text></Pressable>
            <Pressable onPress={() => v.trim() && onOk(v.trim())} style={[styles.btn, styles.ok, !v.trim() && { opacity: 0.4 }]}>
              <Text style={styles.okText}>{okLabel}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'center', padding: 24 },
  box: { backgroundColor: C.card, borderRadius: 20, padding: 20 },
  title: { fontSize: 17, fontWeight: '700', color: C.text },
  hint: { fontSize: 13, color: C.sub, marginTop: 6 },
  input: { marginTop: 14, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.text },
  row: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16, gap: 8 },
  btn: { paddingHorizontal: 16, height: 40, borderRadius: 12, justifyContent: 'center' },
  cancel: { color: C.sub, fontSize: 15, fontWeight: '500' },
  ok: { backgroundColor: C.accent },
  okText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
