import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exportBackup, importBackup } from '../backup';
import { GEMINI_MODELS } from '../core/ai';
import type { Board } from '../db';
import { clearThumbCache, countInstagramUnavailable, hasApiKey, processQueue, reprocessInstagramUnavailable, retryAllNow } from '../processor';
import { ensurePermission, rescheduleReminder } from '../reminders';
import { updateSettings, useSettings, type Settings } from '../settings';
import { useColors } from '../theme';
import { ActionSheet, IconBtn } from './common';

interface Props {
  visible: boolean;
  onClose: () => void;
  boards: Board[];
  pendingCount: number;
  toast: (m: string) => void;
  onInstagram: (mode: 'login' | 'logout') => void;
}

export function SettingsScreen({ visible, onClose, boards, pendingCount, toast, onInstagram }: Props) {
  const c = useColors();
  const s = useSettings();
  const insets = useSafeAreaInsets();
  const [boardPick, setBoardPick] = useState(false);
  const [igLocked, setIgLocked] = useState(0);
  useEffect(() => { if (visible) countInstagramUnavailable().then(setIgLocked); }, [visible, s.igConnected]);

  const set = async (patch: Partial<Settings>, reschedule = false) => {
    await updateSettings(patch);
    if (reschedule) rescheduleReminder();
  };
  const defBoard = boards.find((b) => b.id === s.defaultBoardId);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <View style={styles.top}>
          <IconBtn name="chevron-back" size={26} onPress={onClose} label="Назад" />
          <Text style={[styles.h1, { color: c.text }]}>Настройки</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 + insets.bottom }}>
          <Section title="Оформление">
            <Row label="Тема">
              <Seg value={s.theme} onChange={(v) => set({ theme: v })} options={[['system', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']]} />
            </Row>
          </Section>

          <Section title="ИИ-описания">
            <Row label="Описывать посты ИИ" sub={hasApiKey() ? `Gemini ${GEMINI_MODELS[0]}` : 'Ключ Gemini не найден в сборке'}>
              <Sw value={s.aiEnabled} onChange={(v) => set({ aiEnabled: v })} />
            </Row>
            <Row label="Язык описаний" column>
              <Seg value={s.aiLang} onChange={(v) => set({ aiLang: v })} options={[['ru', 'Русский'], ['en', 'English'], ['orig', 'Как в посте']]} />
            </Row>
            <Row label="Смотреть на превью" sub="Если подпись пустая, ИИ разберёт картинку">
              <Sw value={s.aiVision} onChange={(v) => set({ aiVision: v })} />
            </Row>
            <Row label="Доска по умолчанию" sub={defBoard ? `${defBoard.emoji ?? '📌'} ${defBoard.name}` : 'Авто — выбирает ИИ'} onPress={() => setBoardPick(true)}>
              <Ionicons name="chevron-forward" size={18} color={c.faint} />
            </Row>
            <Row label="Очередь" sub={pendingCount ? `${pendingCount} ждут обработки` : 'Пусто'}>
              {pendingCount > 0 && <SmallBtn label="Повторить" onPress={async () => { toast('Обрабатываю…'); await retryAllNow(); }} />}
            </Row>
          </Section>

          <Section title="После «Поделиться»">
            <Row label="Вернуться в приложение" column>
              <Seg value={String(s.returnDelay)} onChange={(v) => set({ returnDelay: Number(v) })} options={[['0', 'Сразу'], ['2', '2 с'], ['5', '5 с'], ['-1', 'Не уходить']]} />
            </Row>
          </Section>

          <Section title="Напоминания">
            <Row label="Напоминать о забытом" sub="Про пост, который ты сохранил и не открыл">
              <Sw value={s.remOn} onChange={async (v) => {
                if (v && !(await ensurePermission())) toast('Разреши уведомления в настройках Android');
                set({ remOn: v }, true);
              }} />
            </Row>
            {s.remOn && (
              <>
                <Row label="Время">
                  <View style={styles.stepper}>
                    <SmallBtn label="−" onPress={() => set({ remHour: (s.remHour + 23) % 24 }, true)} />
                    <Text style={[styles.time, { color: c.text }]}>{String(s.remHour).padStart(2, '0')}:00</Text>
                    <SmallBtn label="+" onPress={() => set({ remHour: (s.remHour + 1) % 24 }, true)} />
                  </View>
                </Row>
                <Row label="Не чаще чем" column>
                  <Seg value={String(s.remEveryDays)} onChange={(v) => set({ remEveryDays: Number(v) }, true)} options={[['1', 'Раз в день'], ['2', 'Раз в 2 дня'], ['7', 'Раз в неделю']]} />
                </Row>
                <Row label="О постах старше" column>
                  <Seg value={String(s.remAgeDays)} onChange={(v) => set({ remAgeDays: Number(v) }, true)} options={[['3', '3 дней'], ['7', 'недели'], ['14', '2 недель']]} />
                </Row>
              </>
            )}
          </Section>

          <Section title="Instagram">
            <Row label={s.igConnected ? 'Подключён' : 'Не подключён'} sub="Нужен, чтобы читать посты закрытых аккаунтов. Сессия хранится только на телефоне.">
              {s.igConnected ? <SmallBtn label="Выйти" onPress={() => onInstagram('logout')} /> : <SmallBtn label="Войти" accent onPress={() => onInstagram('login')} />}
            </Row>
            {s.igConnected && igLocked > 0 && (
              <Row label={`Закрытые посты: ${igLocked}`} sub="Перечитать их через твою сессию">
                <SmallBtn label="Обновить" onPress={async () => { const n = await reprocessInstagramUnavailable(); toast(`Обновляю ${n}…`); }} />
              </Row>
            )}
          </Section>

          <Section title="Данные">
            <Row label="Экспорт в JSON" sub="Все посты, доски, теги и заметки" onPress={async () => { try { const n = await exportBackup(); toast(`Экспортировано: ${n}`); } catch (e: any) { toast(e?.message || 'Не вышло'); } }}>
              <Ionicons name="share-outline" size={18} color={c.faint} />
            </Row>
            <Row label="Импорт из JSON" sub="Существующие ссылки не дублируются" onPress={async () => {
              try { const r = await importBackup(); if (r) { toast(`Добавлено ${r.added}, пропущено ${r.skipped}`); processQueue(); } } catch (e: any) { Alert.alert('Импорт', e?.message || 'Не вышло'); }
            }}>
              <Ionicons name="download-outline" size={18} color={c.faint} />
            </Row>
            <Row label="Очистить кэш превью" onPress={() => Alert.alert('Очистить кэш превью?', 'Картинки будут грузиться из сети заново.', [
              { text: 'Отмена', style: 'cancel' }, { text: 'Очистить', style: 'destructive', onPress: async () => { await clearThumbCache(); toast('Кэш очищен'); } },
            ])}>
              <Ionicons name="trash-outline" size={18} color={c.faint} />
            </Row>
          </Section>

          <Text style={[styles.about, { color: c.faint }]}>Pinbox {Constants.expoConfig?.version} · данные хранятся только на телефоне</Text>
        </ScrollView>
      </View>
      <ActionSheet visible={boardPick} title="Доска по умолчанию" onClose={() => setBoardPick(false)} actions={[
        { label: `✨  Авто — выбирает ИИ${s.defaultBoardId == null ? '  ✓' : ''}`, onPress: () => set({ defaultBoardId: null }) },
        ...boards.map((b) => ({ label: `${b.emoji ?? '📌'}  ${b.name}${s.defaultBoardId === b.id ? '  ✓' : ''}`, onPress: () => set({ defaultBoardId: b.id }) })),
      ]} />
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={[styles.section, { color: c.faint }]}>{title}</Text>
      <View style={[styles.card, { backgroundColor: c.card }]}>{children}</View>
    </View>
  );
}

function Row({ label, sub, children, onPress, column }: { label: string; sub?: string; children?: React.ReactNode; onPress?: () => void; column?: boolean }) {
  const c = useColors();
  const body = (
    <View style={[styles.row, column && { flexDirection: 'column', alignItems: 'stretch' }]}>
      <View style={{ flex: column ? undefined : 1, paddingRight: 10 }}>
        <Text style={[styles.label, { color: c.text }]}>{label}</Text>
        {!!sub && <Text style={[styles.sub, { color: c.sub }]}>{sub}</Text>}
      </View>
      {column ? <View style={{ marginTop: 10 }}>{children}</View> : children}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>{body}</Pressable> : body;
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const c = useColors();
  return (
    <View style={[styles.seg, { backgroundColor: c.bg }]}>
      {options.map(([v, l]) => (
        <Pressable key={v} onPress={() => onChange(v)} style={[styles.segItem, value === v && { backgroundColor: c.text }]}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: value === v ? c.bg : c.sub }}>{l}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Sw({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const c = useColors();
  return <Switch value={value} onValueChange={onChange} trackColor={{ true: c.text, false: c.line }} thumbColor={value ? c.bg : '#fff'} />;
}

function SmallBtn({ label, onPress, accent }: { label: string; onPress: () => void; accent?: boolean }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.small, { backgroundColor: accent ? c.text : c.bg, opacity: pressed ? 0.6 : 1 }]}>
      <Text style={{ color: accent ? c.bg : c.text, fontWeight: '600', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', height: 52, paddingHorizontal: 6 },
  h1: { fontSize: 20, fontWeight: '700', marginLeft: 4 },
  section: { fontSize: 12.5, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginLeft: 4 },
  card: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  label: { fontSize: 15.5, fontWeight: '500' },
  sub: { fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  seg: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9, paddingHorizontal: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { fontSize: 16, fontWeight: '600', minWidth: 52, textAlign: 'center' },
  small: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, minWidth: 40, alignItems: 'center' },
  about: { textAlign: 'center', fontSize: 12.5, marginTop: 28 },
});
