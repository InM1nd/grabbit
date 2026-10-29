import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, AccessibilityInfo, Animated, Easing, KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Board, Post } from '../db';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { normalizeUrl, PLATFORM_LABEL } from '../core/url';
import { t } from '../i18n';
import { PLATFORM_ICON, timeAgo, useColors } from '../theme';

export type NewPost = { url: string; note: string; boardId: number | null };

function Panel({ title, full, children, footer, onClose, closeDisabled = false, headerAction }: { title: string; full?: boolean; children: React.ReactNode; footer?: React.ReactNode; onClose: () => void; closeDisabled?: boolean; headerAction?: React.ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [progress] = useState(() => new Animated.Value(0));
  const [reduce, setReduce] = useState(true);
  useEffect(() => {
    let alive = true;
    let entry: Animated.CompositeAnimation | undefined;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (!alive) return;
      setReduce(value);
      entry = Animated.timing(progress, { toValue: 1, duration: value ? 0 : 240, easing: Easing.out(Easing.cubic), useNativeDriver: true });
      entry.start();
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { alive = false; subscription.remove(); entry?.stop(); };
  }, [progress]);
  const close = () => { if (closeDisabled) return; Animated.timing(progress, { toValue: 0, duration: reduce ? 0 : 160, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => { if (finished) onClose(); }); };
  return <Modal transparent visible animationType="none" onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'android' ? 'height' : 'padding'} style={styles.overlay}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: c.overlay, opacity: progress }]}><Pressable accessibilityLabel={t('Закрыть окно')} accessibilityRole="button" onPress={close} style={StyleSheet.absoluteFill} /></Animated.View>
      <Animated.View style={[styles.panel, full && styles.fullPanel, { backgroundColor: c.bg, opacity: progress, transform: [{ translateY: reduce ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [32, 0] }) }] }]}>
        <View style={[styles.handle, { backgroundColor: c.line }]} />
        <View style={styles.panelHeader}><Text accessibilityRole="header" style={[styles.panelTitle, { color: c.text }]}>{title}</Text>{headerAction}<Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} onPress={close} disabled={closeDisabled} style={[styles.close, { backgroundColor: c.card }]}><Ionicons name="close" size={20} color={c.text} /></Pressable></View>
        {children}
        {footer && <View style={[styles.footer, { backgroundColor: c.bg, borderColor: c.line, paddingBottom: 16 + insets.bottom }]}>{footer}</View>}
      </Animated.View>
    </KeyboardAvoidingView>
  </Modal>;
}

function Primary({ label, icon = 'arrow-forward', onPress, disabled = false }: { label: string; icon?: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} accessibilityState={{ busy: disabled }} onPress={onPress} style={({ pressed }) => [styles.primary, { backgroundColor: pressed ? '#DE3E35' : '#F8483E', transform: [{ scale: pressed ? 0.985 : 1 }] }]}><Text style={styles.primaryText}>{label}</Text><Ionicons name={icon} color="#fff" size={20} /></Pressable>;
}

function BoardPicker({ boards, value, onChange, automatic = false }: { boards: Board[]; value: number | null; onChange: (id: number | null) => void; automatic?: boolean }) {
  const c = useColors();
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
    {[{ id: null, name: automatic ? t('Авто — выбирает ИИ') : t('Без доски'), emoji: '◌' }, ...boards].map(b => <Pressable key={String(b.id)} accessibilityRole="radio" aria-checked={value === b.id} accessibilityLabel={t('Доска: {name}', { name: b.name })} onPress={() => onChange(b.id)} style={[styles.chip, { backgroundColor: value === b.id ? c.accentSoft : c.card, borderColor: value === b.id ? c.accent : 'transparent' }]}><Text style={{ color: c.text, fontSize: 13 }}>{b.emoji} {b.name}</Text>{value === b.id && <Ionicons name="checkmark" color={c.accent} size={15} />}</Pressable>)}
  </ScrollView>;
}

export function PostPanel({ post, boards, onUpdate, onDelete, onClose, onMenu, onEditNote, onNewBoard, onRemoveTag, onAddTag, extraContent, busy = false }: {
  post: Post; boards: Board[]; onUpdate: (patch: Partial<Post>) => void; onDelete: () => void; onClose: () => void;
  onMenu?: () => void; onEditNote?: () => void; onNewBoard?: () => void; onRemoveTag?: (tag: string) => void;
  onAddTag?: (tag: string) => void; extraContent?: React.ReactNode; busy?: boolean;
}) {
  const c = useColors();
  const [tagInput, setTagInput] = useState('');
  const [pickingBoard, setPickingBoard] = useState(false);
  const [copyMessage, setCopyMessage] = useState('');
  const [showOriginal, setShowOriginal] = useState(false);
  const board = boards.find(b => b.id === post.boardId);
  const img = post.localImage || post.image;
  const source = t(PLATFORM_LABEL[post.platform]);
  const copy = async () => { try { await Clipboard.setStringAsync(post.url); setCopyMessage(t('Ссылка скопирована')); } catch { setCopyMessage(t('Не удалось скопировать. Ссылка есть ниже.')); } };
  return <Panel title={t('Сохранённый пост')} full onClose={onClose} headerAction={onMenu && <Pressable accessibilityRole="button" accessibilityLabel={t('Ещё')} onPress={onMenu} style={styles.close}><Ionicons name="ellipsis-horizontal" size={22} color={c.text} /></Pressable>} footer={<View><View style={styles.footerRow}><View style={{ flex: 1 }}><Primary label={t('Открыть в {p}', { p: source })} icon="open-outline" onPress={() => { void Linking.openURL(post.url).catch(() => setCopyMessage(t('Не удалось открыть ссылку. Попробуй скопировать её.'))); }} /></View><Pressable accessibilityRole="button" accessibilityLabel={t('Скопировать ссылку')} onPress={() => { void copy(); }} style={[styles.copyButton, { backgroundColor: c.card }]}><Ionicons name="copy-outline" color={c.text} size={21} /></Pressable></View>{!!copyMessage && <Text accessibilityRole="alert" style={{ color: c.sub, paddingTop: 10, fontSize: 12 }}>{copyMessage}</Text>}</View>}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.postContent}>
      {img ? <Image source={{ uri: img }} contentFit="cover" style={[styles.hero, { backgroundColor: c.card }]} accessibilityLabel={post.aiTitle || post.title || t('Обложка поста')} /> : <View style={[styles.linkHero, { backgroundColor: c.accentSoft }]}><Ionicons name={PLATFORM_ICON[post.platform] as React.ComponentProps<typeof Ionicons>['name']} size={34} color={c.accent} /><Text numberOfLines={1} style={{ color: c.sub, fontSize: 14 }}>{new URL(post.url).hostname}</Text></View>}
      <View style={styles.sourceRow}><View style={[styles.sourceIcon, { backgroundColor: c.card }]}><Ionicons name={PLATFORM_ICON[post.platform] as React.ComponentProps<typeof Ionicons>['name']} color={c.sub} size={15} /></View><Text numberOfLines={1} style={{ color: c.sub, fontSize: 12, flexShrink: 1 }}>{source}{post.author ? ` · ${post.author}` : ''} · {timeAgo(post.createdAt)}</Text><View style={{ flex: 1 }} /><Ionicons name="bookmark" color={c.accent} size={16} /></View>
      <Text accessibilityRole="header" selectable style={[styles.title, { color: c.text }]}>{post.aiTitle || post.title || post.url}</Text>
      {(post.status === 'pending' || busy) && <View style={[styles.summary, { backgroundColor: c.card }]}><ActivityIndicator color={c.accent} /><Text style={{ color: c.sub }}>{t('ИИ разбирает пост…')}</Text></View>}
      {!!post.summary && <View style={[styles.summary, { backgroundColor: c.card }]}><View style={styles.inline}><Ionicons name="sparkles-outline" size={15} color={c.accent} /><Text style={[styles.eyebrow, { color: c.sub }]}>{t('КОРОТКО О ПОСТЕ')}</Text></View><Text selectable style={[styles.body, { color: c.text }]}>{post.summary}</Text></View>}
      <Text style={[styles.section, { color: c.sub }]}>{t('ЧТО С ЭТИМ СДЕЛАТЬ')}</Text>
      <View style={styles.marks}>{([{ value: 'try', label: t('Попробовать'), icon: 'flask-outline' }, { value: 'done', label: t('Сделано'), icon: 'checkmark-circle-outline' }, { value: 'skip', label: t('Неважно'), icon: 'moon-outline' }] as const).map(mark => <Pressable key={mark.value} accessibilityRole="button" aria-pressed={post.mark === mark.value} onPress={() => onUpdate({ mark: post.mark === mark.value ? null : mark.value })} style={[styles.mark, { backgroundColor: post.mark === mark.value ? c.accentSoft : c.card, borderColor: post.mark === mark.value ? c.accent : 'transparent' }]}><Ionicons name={mark.icon} color={post.mark === mark.value ? c.accent : c.sub} size={19} /><Text style={{ color: c.text, fontSize: 11, fontWeight: '500' }}>{mark.label}</Text></Pressable>)}</View>
      <Text style={[styles.section, { color: c.sub }]}>{t('НА СВОЁМ МЕСТЕ')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Изменить доску')} aria-expanded={pickingBoard} onPress={() => setPickingBoard(v => !v)} style={[styles.boardRow, { borderColor: c.line }]}><Text style={{ fontSize: 24 }}>{board?.emoji || '◌'}</Text><View style={{ flex: 1, gap: 3 }}><Text style={{ color: c.sub, fontSize: 11 }}>{t('ДОСКА')}</Text><Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }}>{board?.name || t('Без доски')}</Text></View><Ionicons name={pickingBoard ? 'chevron-up' : 'chevron-forward'} size={18} color={c.sub} /></Pressable>
      {pickingBoard && <BoardPicker boards={boards} value={post.boardId} onChange={id => { onUpdate({ boardId: id }); setPickingBoard(false); }} />}
      {pickingBoard && onNewBoard && <Pressable onPress={onNewBoard} style={styles.secondary}><Text style={{ color: c.accent }}>{t('Новая доска')}</Text></Pressable>}
      {!!post.tags.length && <View style={[styles.chips, { flexWrap: 'wrap', paddingTop: 12 }]}>{post.tags.map(tag => <Pressable key={tag} onPress={() => onRemoveTag?.(tag)} disabled={!onRemoveTag} style={[styles.tag, { backgroundColor: c.card }]}><Text style={{ color: c.sub, fontSize: 12 }}>#{tag}</Text></Pressable>)}</View>}
      {onAddTag && <TextInput accessibilityLabel={t('+ тег')} value={tagInput} onChangeText={setTagInput} placeholder={t('+ тег')} placeholderTextColor={c.faint} onSubmitEditing={() => { const tag = tagInput.trim().replace(/^#/, '').toLowerCase(); if (tag) onAddTag(tag); setTagInput(''); }} style={[styles.tag, { color: c.text, backgroundColor: c.card, marginTop: 8, minHeight: 40 }]} />}
      <View style={styles.noteHeader}><Text style={[styles.section, { color: c.sub, marginTop: 0, marginBottom: 0 }]}>{t('ЗАМЕТКА ДЛЯ СЕБЯ')}</Text><Ionicons name="create-outline" color={c.sub} size={16} /></View>
      {onEditNote ? <Pressable accessibilityRole="button" accessibilityLabel={t('Изменить заметку')} onPress={onEditNote} style={[styles.note, { backgroundColor: c.card }]}><Text style={{ color: post.note ? c.text : c.faint, fontSize: 14, lineHeight: 21 }}>{post.note || t('Что хочется запомнить?')}</Text></Pressable> : <TextInput accessibilityLabel={t('Заметка к посту')} multiline value={post.note || ''} onChangeText={note => onUpdate({ note })} placeholder={t('Что хочется запомнить?')} placeholderTextColor={c.faint} style={[styles.note, { color: c.text, backgroundColor: c.card }]} />}
      <Pressable accessibilityRole="button" aria-expanded={showOriginal} onPress={() => setShowOriginal(v => !v)} style={[styles.originalRow, { borderColor: c.line }]}><Text style={{ color: c.sub, fontSize: 13 }}>{t('Ссылка и оригинальное описание')}</Text><Ionicons name={showOriginal ? 'chevron-up' : 'chevron-down'} color={c.sub} size={16} /></Pressable>
      {showOriginal && <View style={{ gap: 10, paddingTop: 12 }}><Text selectable style={{ color: c.sub, lineHeight: 21, fontSize: 13 }}>{post.description || t('У этого поста нет отдельного описания.')}</Text><Text selectable style={{ color: c.accent, fontSize: 12 }}>{post.url}</Text></View>}
      {extraContent}
      <Pressable accessibilityRole="button" onPress={onDelete} style={styles.deleteButton}><Ionicons name="trash-outline" color={c.danger} size={17} /><Text style={{ color: c.danger, fontSize: 13 }}>{t('Удалить из сохранённого')}</Text></Pressable>
    </ScrollView>
  </Panel>;
}

export function AddPostPanel({ boards, posts, onSave, onOpen, onClose, initialUrl = '', preview = false }: {
  boards: Board[]; posts: Post[]; onSave: (input: NewPost) => Post | Promise<Post>; onOpen: (post: Post) => void; onClose: () => void;
  initialUrl?: string; preview?: boolean;
}) {
  const c = useColors();
  const [url, setUrl] = useState(initialUrl);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [note, setNote] = useState('');
  const [boardId, setBoardId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Post | null>(null);
  const input = useRef<TextInput>(null);
  const normalize = (raw: string) => normalizeUrl(new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`).href);
  const save = async () => {
    if (savingRef.current) return;
    let clean: string;
    try {
      if (!url.trim()) throw new Error();
      clean = normalize(url.trim());
      const parsed = new URL(clean);
      if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname.includes('.')) throw new Error();
    } catch { setError(t('Вставь полную ссылку, например https://example.com/post')); input.current?.focus(); return; }
    if (posts.some(post => normalize(post.url) === clean)) { setError(t('Этот пост уже сохранён. Найди его в ленте.')); input.current?.focus(); return; }
    setError('');
    savingRef.current = true; setSaving(true);
    try { setSaved(await onSave({ url: clean, note: note.trim(), boardId })); }
    catch (e) { setError(e instanceof Error ? e.message : t('Не удалось сохранить. Попробуй ещё раз.')); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const paste = async () => { try { const text = await Clipboard.getStringAsync(); if (!text.trim()) { setError(t('В буфере нет ссылки. Скопируй её или введи вручную.')); return; } setUrl(text.trim()); setError(''); } catch { setError(t('Нет доступа к буферу. Вставь ссылку в поле вручную.')); } };
  const savedBoard = boards.find(b => b.id === saved?.boardId);
  return <Panel title={saved ? t('Готово') : t('Новое сохранение')} onClose={onClose} closeDisabled={saving} footer={saved ? <View style={{ gap: 12 }}><Primary label={t('Посмотреть пост')} icon="arrow-forward" onPress={() => onOpen(saved)} /><Pressable accessibilityRole="button" onPress={() => { setSaved(null); setUrl(''); setNote(''); setError(''); }} style={styles.secondary}><Text style={{ color: c.sub, fontSize: 14 }}>{t('Добавить ещё')}</Text></Pressable></View> : <><Primary label={saving ? t('Сохраняю…') : t('Сохранить на потом')} icon="bookmark-outline" disabled={saving} onPress={() => { void save(); }} />{preview && <Text style={[styles.demo, { color: c.sub }]}>{t('Дизайн-превью · сохранение только в этой сессии')}</Text>}</>}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.addContent}>
      {saved ? <View style={styles.success}>
        <View style={[styles.successIcon, { backgroundColor: c.accentSoft }]}><Ionicons name="checkmark" size={40} color={c.accent} /></View>
        <Text accessibilityRole="header" style={[styles.successTitle, { color: c.text }]}>{t('Теперь не потеряется')}</Text>
        <Text style={[styles.successSub, { color: c.sub }]}>{t('Ссылка уже на твоей полке.')}{savedBoard ? `\n${savedBoard.emoji} ${savedBoard.name}` : '\n' + t('Можно вернуться к ней в ленте.')}</Text>
        <View style={[styles.savedCard, { backgroundColor: c.card }]}><View style={[styles.savedIcon, { backgroundColor: c.bg }]}><Ionicons name="link-outline" color={c.accent} size={24} /></View><View style={{ flex: 1, gap: 5 }}><Text style={{ color: c.text, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{saved.aiTitle || saved.title || new URL(saved.url).hostname}</Text><Text style={{ color: c.sub, fontSize: 12 }} numberOfLines={1}>{saved.url}</Text></View><Ionicons name="bookmark" color={c.accent} size={18} /></View>
      </View> : <>
        <View style={styles.addIntro}><Image source={require('../../assets/icon.png')} style={styles.mascot} /><View style={{ flex: 1 }}><Text style={[styles.addHeadline, { color: c.text }]}>{t('Хорошие находки — сюда')}</Text><Text style={{ color: c.sub, fontSize: 13, lineHeight: 19 }}>{t('Пост, видео, статья или место.')}{ '\n' }{t('Сохрани сейчас, вернись потом.')}</Text></View></View>
        <Text style={[styles.fieldLabel, { color: c.text }]}>{t('Ссылка')}</Text>
        <View style={[styles.urlField, { backgroundColor: c.card, borderColor: error ? c.danger : c.line }]}><Ionicons name="link-outline" color={c.sub} size={20} /><TextInput ref={input} accessibilityLabel={t('Ссылка на пост')} aria-invalid={!!error} keyboardType="url" autoCapitalize="none" autoCorrect={false} value={url} onChangeText={value => { setUrl(value); setError(''); }} onSubmitEditing={save} placeholder="https://…" placeholderTextColor={c.faint} style={[styles.urlInput, { color: c.text }]} /><Pressable accessibilityRole="button" accessibilityLabel={t('Вставить из буфера')} onPress={() => { void paste(); }} style={styles.paste}><Text style={{ color: c.accent, fontSize: 12, fontWeight: '600' }}>{t('Вставить')}</Text></Pressable></View>
        {!!error && <Text accessibilityRole="alert" style={[styles.error, { color: c.danger }]}>{error}</Text>}
        <Text style={[styles.fieldLabel, { color: c.text, marginTop: 24 }]}>{t('Куда положить')}</Text>
        <BoardPicker automatic={!preview} boards={boards} value={boardId} onChange={setBoardId} />
        <View style={styles.noteHeader}><Text style={[styles.fieldLabel, { color: c.text, marginBottom: 0 }]}>{t('Заметка')}</Text><Text style={{ color: c.faint, fontSize: 12 }}>{t('необязательно')}</Text></View>
        <TextInput accessibilityLabel={t('Заметка к новой ссылке')} multiline value={note} onChangeText={setNote} placeholder={t('Например: попробовать на выходных')} placeholderTextColor={c.faint} style={[styles.note, { color: c.text, backgroundColor: c.card }]} />
        <View style={[styles.addHint, { backgroundColor: c.accentSoft }]}><Ionicons name="sparkles-outline" color={c.accent} size={19} /><Text style={{ flex: 1, color: c.sub, fontSize: 12, lineHeight: 18 }}>{preview ? t('В приложении Grabbit подтянет обложку и поможет с описанием. Здесь сохраняем ссылку и твою заметку.') : t('Grabbit подтянет обложку и поможет с описанием. Можно закрыть окно — обработка продолжится.')}</Text></View>
      </>}
    </ScrollView>
  </Panel>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  panel: { width: '100%', maxWidth: 430, maxHeight: '94%', borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden' }, fullPanel: { height: '97%', maxHeight: '97%' },
  handle: { alignSelf: 'center', width: 32, height: 4, borderRadius: 2, marginTop: 10 }, panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14 }, panelTitle: { fontSize: 15, fontWeight: '600', flex: 1 }, close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  footer: { padding: 16, paddingBottom: 22, borderTopWidth: StyleSheet.hairlineWidth }, footerRow: { flexDirection: 'row', gap: 10 }, primary: { minHeight: 52, paddingHorizontal: 20, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, primaryText: { color: '#fff', fontSize: 15, fontWeight: '700', flexShrink: 1 }, copyButton: { width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  postContent: { paddingHorizontal: 20, paddingBottom: 12 }, hero: { width: '100%', height: 228, borderRadius: 23 }, linkHero: { height: 140, borderRadius: 23, alignItems: 'center', justifyContent: 'center', gap: 12 }, sourceRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 18, marginBottom: 12 }, sourceIcon: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, title: { fontSize: 27, lineHeight: 32, fontWeight: '700', letterSpacing: -0.7, marginBottom: 18 },
  summary: { padding: 16, borderRadius: 19, gap: 10 }, inline: { flexDirection: 'row', alignItems: 'center', gap: 7 }, eyebrow: { fontSize: 10, letterSpacing: 1, fontWeight: '600' }, body: { fontSize: 14, lineHeight: 22 }, section: { fontSize: 10, letterSpacing: 1.1, fontWeight: '600', marginTop: 24, marginBottom: 11 }, marks: { flexDirection: 'row', gap: 7 }, mark: { flex: 1, borderWidth: 1, borderRadius: 15, minHeight: 66, alignItems: 'center', justifyContent: 'center', gap: 6 },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 17, padding: 14 }, chips: { flexDirection: 'row', gap: 7, paddingVertical: 2 }, chip: { minHeight: 40, borderRadius: 14, paddingHorizontal: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }, tag: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 }, noteHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 10 }, note: { borderRadius: 16, padding: 14, minHeight: 82, textAlignVertical: 'top', fontSize: 14, lineHeight: 21 }, originalRow: { borderTopWidth: 1, marginTop: 24, paddingTop: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, deleteButton: { minHeight: 48, marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  addContent: { paddingHorizontal: 20, paddingBottom: 20 }, addIntro: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 26, marginTop: 4 }, mascot: { width: 52, height: 52, borderRadius: 17 }, addHeadline: { fontSize: 19, fontWeight: '700', letterSpacing: -0.4, marginBottom: 5 }, fieldLabel: { fontSize: 14, fontWeight: '600', marginBottom: 10 }, urlField: { borderWidth: 1, minHeight: 54, borderRadius: 17, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, gap: 8 }, urlInput: { flex: 1, minWidth: 0, fontSize: 14, height: 52 }, paste: { paddingHorizontal: 12, minHeight: 48, justifyContent: 'center' }, error: { fontSize: 12, lineHeight: 18, marginTop: 8 }, addHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 16, marginTop: 20 }, demo: { textAlign: 'center', fontSize: 10, marginTop: 10 },
  secondary: { alignItems: 'center', justifyContent: 'center', minHeight: 38 }, success: { alignItems: 'center', paddingTop: 20, paddingBottom: 14 }, successIcon: { width: 80, height: 80, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 22 }, successTitle: { fontSize: 25, letterSpacing: -0.6, fontWeight: '700', marginBottom: 12 }, successSub: { fontSize: 14, textAlign: 'center', lineHeight: 23 }, savedCard: { alignSelf: 'stretch', marginTop: 26, padding: 14, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 12 }, savedIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
