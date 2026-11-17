import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { parseReminderTime, reminderInputValue, reminderPreset } from '../core/reminderTime';
import { getLang, t } from '../i18n';
import { useColors } from '../theme';
import { ActionSheet, PromptModal } from './common';

type Props = {
  at: number | null;
  onSave: (at: number) => boolean | Promise<boolean>;
  onCancel: () => void | Promise<void>;
};

export function PostReminderControl({ at, onSave, onCancel }: Props) {
  const c = useColors();
  const [picker, setPicker] = useState(false);
  const [custom, setCustom] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [invalid, setInvalid] = useState(false);
  const busy = useRef(false);

  const save = async (date: number | null) => {
    if (date == null || date <= Date.now()) { setInvalid(true); return; }
    if (busy.current) return;
    busy.current = true;
    setCustom(null);
    setMessage('');
    try {
      if (!await onSave(date)) setMessage(t('Разреши уведомления Grabbit в настройках телефона.'));
    } catch { setMessage(t('Не удалось изменить напоминание.')); }
    finally { busy.current = false; }
  };
  const cancel = async () => {
    if (busy.current) return;
    busy.current = true;
    setMessage('');
    try { await onCancel(); }
    catch { setMessage(t('Не удалось изменить напоминание.')); }
    finally { busy.current = false; }
  };
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  useEffect(() => {
    if (at == null) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = at - Date.now();
      if (remaining <= 0) setExpiredAt(at);
      else timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    timer = setTimeout(check, Math.max(0, Math.min(at - Date.now(), 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [at]);
  const scheduled = at != null && at !== expiredAt ? at : null;
  const display = scheduled == null ? t('Напомнить') :
    new Intl.DateTimeFormat(getLang(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(scheduled);

  return <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderColor: c.line }}>
    <Pressable accessibilityRole="button" accessibilityLabel={scheduled == null ? display : t('Напоминание') + ' ' + display}
      onPress={() => { if (!busy.current) setPicker(true); }} style={styles.row}>
      <Ionicons name={scheduled == null ? 'notifications-outline' : 'notifications'} color={scheduled == null ? c.sub : c.accent} size={20} />
      <Text style={{ flex: 1, color: c.text, fontWeight: '600', fontSize: 14 }}>{display}</Text>
      <Ionicons name="chevron-forward" size={18} color={c.sub} />
    </Pressable>
    {!!message && <Text accessibilityRole="alert" style={{ color: c.warn, paddingHorizontal: 14, paddingBottom: 10 }}>{message}</Text>}
    <ActionSheet title={t('Напоминание')} visible={picker} onClose={() => setPicker(false)} actions={[
      { label: t('Завтра в 19:00'), icon: 'today-outline', onPress: () => { void save(reminderPreset('tomorrow')); } },
      { label: t('На выходных в 19:00'), icon: 'calendar-outline', onPress: () => { void save(reminderPreset('weekend')); } },
      { label: t('Выбрать дату и время'), icon: 'time-outline', onPress: () => { setInvalid(false); setCustom(reminderInputValue(scheduled ?? reminderPreset('tomorrow'))); } },
      ...(scheduled == null ? [] : [{ label: t('Отменить напоминание'), icon: 'notifications-off-outline', destructive: true, onPress: () => { void cancel(); } }]),
    ]} />
    <PromptModal visible={custom != null} title={t('Выбрать дату и время')} initial={custom ?? ''}
      hint={invalid ? t('Введи будущую дату и время, например 2026-12-05 19:00.') : t('Формат: ГГГГ-ММ-ДД ЧЧ:ММ')}
      onCancel={() => setCustom(null)} onOk={(value) => { void save(parseReminderTime(value)); }} />
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 14 },
});
