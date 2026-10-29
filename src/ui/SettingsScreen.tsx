import { useDialog } from './dialog';
import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { aiMode, ensureAiAuth, hasUserKey, setUserKey } from '../aiAuth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exportBackup, importBackup } from '../backup';
import { GEMINI_MODELS } from '../core/ai';
import type { Board } from '../db';
import { clearThumbCache, countInstagramUnavailable, processQueue, reprocessInstagramUnavailable, retryAllNow } from '../processor';
import { ensurePermission, rescheduleReminder } from '../reminders';
import { updateSettings, useSettings, type Settings } from '../settings';
import { useColors } from '../theme';
import { checkForUpdate, currentVersion, downloadAndInstall, releasesPage, UpdateError, type UpdateInfo } from '../updater';
import { ActionSheet, IconBtn } from './common';
import { markReopenSettings, t } from '../i18n';

interface Props {
  visible: boolean;
  onClose: () => void;
  boards: Board[];
  pendingCount: number;
  toast: (m: string) => void;
  onInstagram: (mode: 'login' | 'logout') => void;
  initialUpdate?: UpdateInfo | null;
}

export function SettingsScreen({ visible, onClose, boards, pendingCount, toast, onInstagram, initialUpdate }: Props) {
  const dialog = useDialog();
  const c = useColors();
  const s = useSettings();
  const insets = useSafeAreaInsets();
  const [boardPick, setBoardPick] = useState(false);
  const [igLocked, setIgLocked] = useState(0);
  useEffect(() => { if (visible) countInstagramUnavailable().then(setIgLocked); }, [visible, s.igConnected]);

  const [upd, setUpd] = useState<{ busy?: boolean; sub?: string; info?: UpdateInfo; newer?: boolean; notConfigured?: boolean; progress?: number | null }>({});
  const check = async () => {
    setUpd({ busy: true });
    try {
      const r = await checkForUpdate();
      setUpd({ info: r.info, newer: r.newer, sub: r.newer ? t('Есть новая версия') : t('У тебя последняя версия') });
    } catch (e: any) {
      if (e instanceof UpdateError && e.code === 'not-configured') setUpd({ notConfigured: true, sub: t('Нет доступа к релизам (приватный репозиторий)') });
      else if (e instanceof UpdateError && e.code === 'no-apk') setUpd({ sub: t('В последнем релизе нет APK') });
      else setUpd({ sub: t('Не удалось проверить: {e}', { e: String(e?.message || e) }) });
    }
  };
  const install = async () => {
    if (!upd.info || upd.progress != null) return;
    const info = upd.info;
    setUpd((u) => ({ ...u, progress: 0 }));
    try {
      await downloadAndInstall(info, (f) => setUpd((u) => ({ ...u, progress: f })));
      setUpd((u) => ({ ...u, progress: null }));
    } catch (e: any) {
      setUpd((u) => ({ ...u, progress: null }));
      dialog.info({ title: t('Обновление'), message: t('Не удалось скачать: {e}', { e: String(e?.message || e) }), danger: true, buttons: [
        { label: t('Открыть в браузере'), primary: true, onPress: () => Linking.openURL(info.pageUrl || releasesPage()) },
        { label: t('Отмена') },
      ] });
    }
  };
  useEffect(() => { if (visible && initialUpdate) setUpd({ info: initialUpdate, newer: true, sub: t('Есть новая версия') }); }, [visible, initialUpdate]);

  const set = async (patch: Partial<Settings>, reschedule = false) => {
    await updateSettings(patch);
    if (reschedule) rescheduleReminder();
  };
  const defBoard = boards.find((b) => b.id === s.defaultBoardId);
  const [keyEdit, setKeyEdit] = useState(false);
  const [, bump] = useState(0);
  useEffect(() => { if (visible) ensureAiAuth()?.then(() => bump((x) => x + 1)); }, [visible]);
  const mode = aiMode();
  const aiSub = mode === 'own' ? t('Свой ключ, без лимитов') : mode === 'proxy' ? t('Бесплатно через сервер Grabbit, 50 постов в день') : mode === 'build' ? `Gemini ${GEMINI_MODELS[0]}` : t('Ключ Gemini не найден в сборке');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <View style={styles.top}>
          <IconBtn name="chevron-back" size={26} onPress={onClose} label={t('Назад')} />
          <Text style={[styles.h1, { color: c.text }]}>{t('Настройки')}</Text>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 + insets.bottom }}>
          <Section title={t('Оформление')}>
            <Row label={t('Язык интерфейса')} column>
              <Seg value={s.uiLang} onChange={(v) => { if (v !== s.uiLang) { markReopenSettings(); set({ uiLang: v }); } }} options={[['system', t('Системный')], ['ru', 'RU'], ['en', 'EN'], ['uk', 'UK']]} />
            </Row>
            <Row label={t('Тема')}>
              <Seg value={s.theme} onChange={(v) => set({ theme: v })} options={[['system', t('Авто')], ['light', t('Светлая')], ['dark', t('Тёмная')]]} />
            </Row>
          </Section>

          <Section title={t('ИИ-описания')}>
            <Row label={t('Описывать посты ИИ')} sub={aiSub}>
              <Sw value={s.aiEnabled} onChange={(v) => set({ aiEnabled: v })} />
            </Row>
            <Row label={t('Свой ключ Gemini')} sub={hasUserKey() ? t('Добавлен · лимиты сняты') : t('Необязательно. Снимает дневной лимит')} onPress={() => setKeyEdit(true)}>
              <Ionicons name="chevron-forward" size={18} color={c.faint} />
            </Row>
            <Row label={t('Язык описаний')} column>
              <Seg value={s.aiLang} onChange={(v) => set({ aiLang: v })} options={[['ru', t('Русский')], ['en', 'English'], ['orig', t('Как в посте')]]} />
            </Row>
            <Row label={t('Смотреть на превью')} sub={t('Если подпись пустая, ИИ разберёт картинку')}>
              <Sw value={s.aiVision} onChange={(v) => set({ aiVision: v })} />
            </Row>
            <Row label={t('Доска по умолчанию')} sub={defBoard ? `${defBoard.emoji ?? '📌'} ${defBoard.name}` : t('Авто — выбирает ИИ')} onPress={() => setBoardPick(true)}>
              <Ionicons name="chevron-forward" size={18} color={c.faint} />
            </Row>
            <Row label={t('Очередь')} sub={pendingCount ? t('{n} ждут обработки', { n: pendingCount }) : t('Пусто')}>
              {pendingCount > 0 && <SmallBtn label={t('Повторить')} onPress={async () => { toast(t('Обрабатываю…')); await retryAllNow(); }} />}
            </Row>
          </Section>

          <Section title={t('После «Поделиться»')}>
            <Row label={t('Вернуться в приложение')} column>
              <Seg value={String(s.returnDelay)} onChange={(v) => set({ returnDelay: Number(v) })} options={[['0', t('Сразу')], ['2', t('2 с')], ['5', t('5 с')], ['-1', t('Не уходить')]]} />
            </Row>
          </Section>

          <Section title={t('Напоминания')}>
            <Row label={t('Напоминать о забытом')} sub={t('Про пост, который ты сохранил и не открыл')}>
              <Sw value={s.remOn} onChange={async (v) => {
                if (v && !(await ensurePermission())) toast(t('Разреши уведомления в настройках Android'));
                set({ remOn: v }, true);
              }} />
            </Row>
            {s.remOn && (
              <>
                <Row label={t('Время')}>
                  <View style={styles.stepper}>
                    <SmallBtn label="−" onPress={() => set({ remHour: (s.remHour + 23) % 24 }, true)} />
                    <Text style={[styles.time, { color: c.text }]}>{String(s.remHour).padStart(2, '0')}:00</Text>
                    <SmallBtn label="+" onPress={() => set({ remHour: (s.remHour + 1) % 24 }, true)} />
                  </View>
                </Row>
                <Row label={t('Не чаще чем')} column>
                  <Seg value={String(s.remEveryDays)} onChange={(v) => set({ remEveryDays: Number(v) }, true)} options={[['1', t('Раз в день')], ['2', t('Раз в 2 дня')], ['7', t('Раз в неделю')]]} />
                </Row>
                <Row label={t('О постах старше')} column>
                  <Seg value={String(s.remAgeDays)} onChange={(v) => set({ remAgeDays: Number(v) }, true)} options={[['3', t('3 дней')], ['7', t('недели')], ['14', t('2 недель')]]} />
                </Row>
              </>
            )}
          </Section>

          <Section title="Instagram">
            <Row label={s.igConnected ? t('Подключён') : t('Не подключён')} sub={t('Нужен, чтобы читать посты закрытых аккаунтов. Сессия хранится только на телефоне.')}>
              {s.igConnected ? <SmallBtn label={t('Выйти')} onPress={() => onInstagram('logout')} /> : <SmallBtn label={t('Войти')} accent onPress={() => onInstagram('login')} />}
            </Row>
            {s.igConnected && igLocked > 0 && (
              <Row label={t('Закрытые посты: {n}', { n: igLocked })} sub={t('Перечитать их через твою сессию')}>
                <SmallBtn label={t('Обновить')} onPress={async () => { const n = await reprocessInstagramUnavailable(); toast(t('Обновляю {n}…', { n })); }} />
              </Row>
            )}
          </Section>

          <Section title={t('Данные')}>
            <Row label={t('Экспорт в JSON')} sub={t('Все посты, доски, теги и заметки')} onPress={async () => { try { const n = await exportBackup(); toast(t('Экспортировано: {n}', { n })); } catch (e: any) { toast(e?.message || t('Не вышло')); } }}>
              <Ionicons name="share-outline" size={18} color={c.faint} />
            </Row>
            <Row label={t('Импорт из JSON')} sub={t('Существующие ссылки не дублируются')} onPress={async () => {
              try { const r = await importBackup(); if (r) { toast(t('Добавлено {a}, пропущено {s}', { a: r.added, s: r.skipped })); processQueue(); } } catch (e: any) { dialog.info({ title: t('Импорт'), message: e?.message || t('Не вышло'), danger: true }); }
            }}>
              <Ionicons name="download-outline" size={18} color={c.faint} />
            </Row>
            <Row label={t('Очистить кэш превью')} onPress={async () => { if (await dialog.confirm({ title: t('Очистить кэш превью?'), message: t('Картинки будут грузиться из сети заново.'), confirmLabel: t('Очистить'), danger: true, icon: 'images-outline' })) { await clearThumbCache(); toast(t('Кэш очищен')); } }}>
              <Ionicons name="trash-outline" size={18} color={c.faint} />
            </Row>
          </Section>

          <Section title={t('Обновления')}>
            <Row label={t('Версия {v}', { v: currentVersion() })} sub={upd.sub}>
              {upd.busy ? <ActivityIndicator color={c.text} /> : <SmallBtn label={t('Проверить обновления')} onPress={check} />}
            </Row>
            {upd.info && upd.newer && (
              <Row label={t('Доступна версия {v}', { v: upd.info.version })} sub={upd.info.notes ? upd.info.notes.split('\n').slice(0, 4).join('\n') : undefined}>
                <SmallBtn label={upd.progress != null ? `${Math.round(upd.progress * 100)}%` : t('Установить')} accent onPress={install} />
              </Row>
            )}
            {upd.notConfigured && (
              <Row label={t('Открыть страницу релизов')} sub={t('Репозиторий приватный — скачай APK в браузере, войдя в GitHub')} onPress={() => Linking.openURL(releasesPage())}>
                <Ionicons name="open-outline" size={18} color={c.faint} />
              </Row>
            )}
            <Row label={t('Проверять при запуске')}>
              <Sw value={s.updAuto} onChange={(v) => set({ updAuto: v })} />
            </Row>
          </Section>

          <Text style={[styles.about, { color: c.faint }]}>Grabbit {currentVersion()} · {t('Данные хранятся только на телефоне')}</Text>
        </ScrollView>
      </View>
      <ActionSheet visible={boardPick} title={t('Доска по умолчанию')} onClose={() => setBoardPick(false)} actions={[
        { label: `✨  ${t('Авто — выбирает ИИ')}${s.defaultBoardId == null ? '  ✓' : ''}`, onPress: () => set({ defaultBoardId: null }) },
        ...boards.map((b) => ({ label: `${b.emoji ?? '📌'}  ${b.name}${s.defaultBoardId === b.id ? '  ✓' : ''}`, onPress: () => set({ defaultBoardId: b.id }) })),
      ]} />
      <KeyModal visible={keyEdit} has={hasUserKey()} onClose={() => setKeyEdit(false)} onSave={async (k) => {
        await setUserKey(k); setKeyEdit(false); bump((x) => x + 1);
        toast(k ? t('Ключ сохранён') : t('Ключ удалён'));
        if (k) retryAllNow();
      }} />
    </Modal>
  );
}

function KeyModal({ visible, has, onClose, onSave }: { visible: boolean; has: boolean; onClose: () => void; onSave: (k: string | null) => void }) {
  const c = useColors();
  const [v, setV] = useState('');
  useEffect(() => { if (visible) setV(''); }, [visible]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.keyBack} onPress={onClose}>
        <Pressable style={[styles.keyCard, { backgroundColor: c.elevated }]} onPress={() => {}}>
          <Text style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>{t('Свой ключ Gemini')}</Text>
          <Text style={{ color: c.sub, marginTop: 6, lineHeight: 20 }}>{t('Бесплатный ключ можно взять в Google AI Studio. Он хранится только на телефоне в защищённом хранилище, и запросы идут напрямую в Google без лимитов Grabbit.')}</Text>
          <Pressable onPress={() => Linking.openURL('https://aistudio.google.com/apikey')}><Text style={{ color: c.accent, marginTop: 8, fontWeight: '600' }}>aistudio.google.com/apikey</Text></Pressable>
          <TextInput value={v} onChangeText={setV} placeholder={has ? t('Ключ сохранён · вставь новый') : 'AIza…'} placeholderTextColor={c.faint}
            autoCapitalize="none" autoCorrect={false} secureTextEntry style={[styles.keyInput, { color: c.text, backgroundColor: c.card }]} />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            {has && <SmallBtn label={t('Удалить')} onPress={() => onSave(null)} />}
            <SmallBtn label={t('Отмена')} onPress={onClose} />
            <SmallBtn label={t('Сохранить')} accent onPress={() => v.trim() && onSave(v.trim())} />
          </View>
        </Pressable>
      </Pressable>
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
  keyBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  keyCard: { borderRadius: 20, padding: 20 },
  keyInput: { marginTop: 14, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
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
