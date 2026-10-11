import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLATFORM_LABEL } from '../core/url';
import * as db from '../db';
import { onDataChanged } from '../events';
import { deleteThumb, reprocess } from '../processor';
import { useSettings } from '../settings';
import { PLATFORM_ICON, timeAgo, useColors } from '../theme';
import { ActionSheet, Chip, IconBtn, PromptModal } from './common';
import { thumbAspect } from './PostCard';
import { t } from '../i18n';

interface Props {
  postId: number | null;
  boards: db.Board[];
  onClose: () => void;
  toast: (msg: string) => void;
  onConnectInstagram: () => void;
}

export function DetailScreen({ postId, boards, onClose, toast, onConnectInstagram }: Props) {
  const c = useColors();
  const st = useSettings();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [post, setPost] = useState<db.Post | null>(null);
  const [showDesc, setShowDesc] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pickBoard, setPickBoard] = useState(false);
  const [newBoard, setNewBoard] = useState(false);
  const [editNote, setEditNote] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (postId == null) { setPost(null); return; }
    let alive = true;
    const load = () => db.getPost(postId).then((p) => alive && setPost(p));
    load();
    db.markOpened(postId);
    setShowDesc(false);
    const off = onDataChanged(load);
    return () => { alive = false; off(); };
  }, [postId]);

  const board = post?.boardId ? boards.find((b) => b.id === post.boardId) : undefined;
  const img = post ? post.localImage || post.image : null;
  const needsHelp = !!post && post.status !== 'pending' && (post.unavailable || post.status === 'error' || (post.metaBlocked && !post.note));

  const openOriginal = async () => { if (post) try { await Linking.openURL(post.url); } catch { toast(t('Не удалось открыть ссылку')); } };
  const remove = () => post && Alert.alert(t('Удалить пост?'), t('Он пропадёт из ленты и досок.'), [
    { text: t('Отмена'), style: 'cancel' },
    { text: t('Удалить'), style: 'destructive', onPress: async () => { deleteThumb(post.id); await db.deletePost(post.id); onClose(); toast(t('Удалено')); } },
  ]);
  const setBoard = async (id: number | null) => { if (post) await db.updatePost(post.id, { board_id: id }); setPickBoard(false); };
  const addTag = async () => {
    const t = tagInput.trim().toLowerCase().replace(/^#/, '');
    if (post && t && !post.tags.includes(t)) await db.updatePost(post.id, { tags: [...post.tags, t] });
    setTagInput('');
  };
  const removeTag = async (t: string) => { if (post) await db.updatePost(post.id, { tags: post.tags.filter((x) => x !== t) }); };
  const redo = async (refetch: boolean) => {
    if (!post) return;
    setBusy(true);
    await db.updatePost(post.id, { board_id: null });
    await reprocess(post.id, refetch);
    setBusy(false);
    const p = await db.getPost(post.id);
    toast(p?.status === 'done' ? t('Описание обновлено') : t('Не вышло — попробую позже'));
  };
  const saveNote = async (v: string) => {
    if (!post) return;
    setEditNote(false);
    await db.updatePost(post.id, { note: v });
    redo(false);
  };

  return (
    <Modal visible={postId != null} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <View style={styles.topBar}>
          <IconBtn name="chevron-back" size={26} onPress={onClose} label={t('Назад')} />
          <View style={{ flex: 1 }} />
          <IconBtn name="ellipsis-horizontal" onPress={() => setMenu(true)} label={t('Ещё')} />
        </View>
        {!post ? <ActivityIndicator style={{ marginTop: 40 }} color={c.accent} /> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 110 + insets.bottom }} keyboardShouldPersistTaps="handled">
            {!!img && (
              <Pressable onPress={openOriginal} style={{ paddingHorizontal: 14 }}>
                <Image source={{ uri: img }} style={{ width: width - 28, height: Math.min((width - 28) / thumbAspect(post), 540), borderRadius: 22, backgroundColor: c.card }} contentFit="cover" />
              </Pressable>
            )}
            <View style={styles.content}>
              <View style={styles.metaRow}>
                <Ionicons name={PLATFORM_ICON[post.platform] as any} size={14} color={c.sub} />
                <Text style={[styles.meta, { color: c.sub }]} numberOfLines={1}>
                  {PLATFORM_LABEL[post.platform]}{post.author ? ` · ${post.author}` : ''} · {timeAgo(post.createdAt)}
                </Text>
              </View>
              <Text style={[styles.title, { color: c.text }]} selectable>{post.aiTitle || post.title || post.url}</Text>

              {post.status === 'pending' || busy ? (
                <View style={styles.row}><ActivityIndicator color={c.accent} /><Text style={[styles.muted, { color: c.sub }]}>  {t('ИИ разбирает пост…')}</Text></View>
              ) : post.summary ? (
                <Text style={[styles.summary, { color: c.text }]} selectable>{post.summary}</Text>
              ) : null}

              {needsHelp && (
                <View style={[styles.help, { backgroundColor: c.card }]}>
                  <Text style={[styles.helpText, { color: c.sub }]}>
                    {post.unavailable
                      ? t('Пост закрыт: аккаунт приватный или нужен вход. Подключи Instagram или напиши пару слов — ИИ перепишет описание.')
                      : t('Сайт почти ничего не отдал. Напиши пару слов о посте — ИИ перепишет описание.')}
                  </Text>
                  <View style={[styles.row, { marginTop: 10, gap: 8, flexWrap: 'wrap' }]}>
                    <Chip label={t('✎ Заметка')} active onPress={() => setEditNote(true)} />
                    {post.platform === 'instagram' && !st.igConnected && <Chip label={t('Подключить Instagram')} onPress={onConnectInstagram} />}
                  </View>
                </View>
              )}

              <View style={[styles.row, { flexWrap: 'wrap', gap: 8, marginTop: 18 }]}>
                <Chip label={board ? `${board.emoji ?? '📌'} ${board.name}` : t('＋ Доска')} active onPress={() => setPickBoard(true)} />
                {post.tags.map((tag) => <Chip key={tag} label={`#${tag}`} onLongPress={() => removeTag(tag)} onPress={() => Alert.alert(`#${tag}`, undefined, [{ text: t('Отмена'), style: 'cancel' }, { text: t('Удалить тег'), style: 'destructive', onPress: () => removeTag(tag) }])} />)}
                <TextInput value={tagInput} onChangeText={setTagInput} placeholder={t('+ тег')} placeholderTextColor={c.faint} onSubmitEditing={addTag} blurOnSubmit={false} returnKeyType="done"
                  style={[styles.tagInput, { color: c.text, backgroundColor: c.chip }]} />
              </View>

              {!!post.note && (
                <Pressable onPress={() => setEditNote(true)} style={[styles.noteBox, { borderColor: c.line }]}>
                  <Text style={[styles.label, { color: c.faint }]}>{t('Заметка')}</Text>
                  <Text style={[styles.body, { color: c.text }]}>{post.note}</Text>
                </Pressable>
              )}

              {!!post.description && (
                <Pressable onPress={() => setShowDesc(!showDesc)} style={{ marginTop: 22 }}>
                  <Text style={[styles.label, { color: c.faint }]}>{t('Оригинал')} {showDesc ? '▴' : '▾'}</Text>
                  <Text style={[styles.body, { color: c.sub }]} numberOfLines={showDesc ? undefined : 3} selectable>{post.description}</Text>
                </Pressable>
              )}
            </View>
          </ScrollView>
        )}
        {post && (
          <View style={[styles.bottom, { paddingBottom: 12 + insets.bottom, backgroundColor: c.bg }]}>
            <Pressable onPress={openOriginal} style={({ pressed }) => [styles.primary, { backgroundColor: c.text, opacity: pressed ? 0.85 : 1 }]}>
              <Text style={[styles.primaryText, { color: c.bg }]}>{t('Открыть в {p}', { p: t(PLATFORM_LABEL[post.platform]) })}</Text>
            </Pressable>
          </View>
        )}
      </View>

      <ActionSheet visible={menu} onClose={() => setMenu(false)} actions={[
        { label: post?.note ? t('Изменить заметку') : t('Добавить заметку'), icon: 'create-outline', onPress: () => setEditNote(true) },
        { label: t('Переописать с ИИ'), icon: 'sparkles-outline', onPress: () => redo(true) },
        { label: t('Скопировать ссылку'), icon: 'link-outline', onPress: async () => { if (post) { await Clipboard.setStringAsync(post.url); toast(t('Ссылка скопирована')); } } },
        { label: t('Поделиться'), icon: 'share-outline', onPress: () => post && Share.share({ message: post.url }) },
        { label: t('Удалить'), icon: 'trash-outline', destructive: true, onPress: remove },
      ]} />
      <ActionSheet visible={pickBoard} title={t('Доска')} onClose={() => setPickBoard(false)} actions={[
        ...boards.map((b) => ({ label: `${b.emoji ?? '📌'}  ${b.name}${post?.boardId === b.id ? '  ✓' : ''}`, onPress: () => setBoard(b.id) })),
        { label: t('＋  Новая доска'), onPress: () => setNewBoard(true) },
      ]} />
      <PromptModal visible={newBoard} title={t('Новая доска')} placeholder={t('Название')} onCancel={() => setNewBoard(false)}
        onOk={async (v) => { const id = await db.getOrCreateBoard(v); await setBoard(id); setNewBoard(false); }} />
      <PromptModal visible={editNote} title={t('Заметка')} multiline initial={post?.note ?? ''} placeholder={t('О чём этот пост? Например: нейросеть для монтажа видео')}
        hint={t('ИИ учтёт заметку и перепишет описание.')} okLabel={t('Сохранить')} onCancel={() => setEditNote(false)} onOk={saveNote} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, height: 52 },
  content: { paddingHorizontal: 20, paddingTop: 16 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontSize: 13, flexShrink: 1 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', marginTop: 8 },
  summary: { fontSize: 16, lineHeight: 23, marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  muted: { fontSize: 14 },
  help: { borderRadius: 16, padding: 14, marginTop: 16 },
  helpText: { fontSize: 14, lineHeight: 20 },
  tagInput: { minWidth: 80, height: 34, borderRadius: 18, paddingHorizontal: 14, fontSize: 14, paddingVertical: 0 },
  noteBox: { marginTop: 18, borderWidth: 1, borderRadius: 14, padding: 12 },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', marginBottom: 6, letterSpacing: 0.4 },
  body: { fontSize: 14.5, lineHeight: 21 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10 },
  primary: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 16, fontWeight: '600' },
});
