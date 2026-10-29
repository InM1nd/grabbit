import { useDialog } from './dialog';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import * as db from '../db';
import { onDataChanged } from '../events';
import { deleteThumb, reprocess } from '../processor';
import { useSettings } from '../settings';
import { useColors } from '../theme';
import { ActionSheet, Chip, IconBtn, PromptModal } from './common';
import { similarPosts } from '../core/embed';
import { cardTitle } from './PostCard';
import { t } from '../i18n';
import { PostPanel } from './PostExperience';

interface Props {
  postId: number | null;
  boards: db.Board[];
  onClose: () => void;
  toast: (msg: string) => void;
  onConnectInstagram: () => void;
  onOpenPost?: (id: number) => void;
}

export function DetailScreen({ postId, boards, onClose, toast, onConnectInstagram, onOpenPost }: Props) {
  const dialog = useDialog();
  const c = useColors();
  const st = useSettings();
  const [post, setPost] = useState<db.Post | null>(null);
  const [menu, setMenu] = useState(false);
  const [pickBoard, setPickBoard] = useState(false);
  const [newBoard, setNewBoard] = useState(false);
  const [editNote, setEditNote] = useState(false);
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<db.Post[]>([]);

  useEffect(() => {
    if (postId == null) return;
    let alive = true;
    const load = async () => {
      const p = await db.getPost(postId);
      if (!alive) return;
      setPost(p);
      if (p) {
        const all = await db.listPosts({ mark: 'default' });
        if (alive) setSimilar(similarPosts(p, all, 6));
      }
    };
    load();
    db.markOpened(postId);
    const off = onDataChanged(load);
    return () => { alive = false; off(); };
  }, [postId]);

  const board = post?.boardId ? boards.find((b) => b.id === post.boardId) : undefined;
  const img = post ? post.localImage || post.image : null;
  const needsHelp = !!post && post.status !== 'pending' && (post.unavailable || post.status === 'error' || (post.metaBlocked && !post.note));

  const remove = async () => {
    if (!post) return;
    const ok = await dialog.confirm({ title: t('Удалить пост?'), message: t('Он пропадёт из ленты и досок.'), confirmLabel: t('Удалить'), danger: true,
      preview: { image: img, title: post.aiTitle || post.title || post.url, sub: [post.platform, board ? `${board.emoji ?? ''} ${board.name}`.trim() : ''].filter(Boolean).join(' · ') } });
    if (!ok) return;
    deleteThumb(post.id); await db.deletePost(post.id); onClose(); toast(t('Удалено'));
  };
  const setBoard = async (id: number | null) => { if (post) await db.updatePost(post.id, { board_id: id }); setPickBoard(false); };
  const addTag = async (t: string) => {
    if (post && t && !post.tags.includes(t)) { await db.clearEmbedding(post.id); await db.updatePost(post.id, { tags: [...post.tags, t] }); }
  };
  const removeTag = async (t: string) => { if (post) { await db.clearEmbedding(post.id); await db.updatePost(post.id, { tags: post.tags.filter((x) => x !== t) }); } };
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

  if (postId == null) return null;
  return <>
    {post?.id === postId ? <PostPanel key={post.id} post={post} boards={boards} onClose={onClose} onDelete={() => { void remove(); }}
      onMenu={() => setMenu(true)} onEditNote={() => setEditNote(true)} onNewBoard={() => setNewBoard(true)} busy={busy}
      onRemoveTag={async tag => { if (await dialog.confirm({ title: `#${tag}`, confirmLabel: t('Удалить тег'), danger: true, icon: 'pricetag-outline' })) await removeTag(tag); }}
      onAddTag={tag => { void addTag(tag); }}
      onUpdate={patch => {
        if ('boardId' in patch) void setBoard(patch.boardId ?? null);
        if ('mark' in patch) { void db.setMark(post.id, patch.mark ?? null); if (patch.mark === 'skip') toast(t('Скрыто из ленты: «Неважно»')); }
      }}
      extraContent={<>
        {needsHelp && <View style={[styles.help, { backgroundColor: c.card }]}>
          <Text style={{ color: c.sub, fontSize: 14, lineHeight: 21 }}>{post.unavailable ? t('Пост закрыт: аккаунт приватный или нужен вход. Подключи Instagram или напиши пару слов — ИИ перепишет описание.') : t('Сайт почти ничего не отдал. Напиши пару слов о посте — ИИ перепишет описание.')}</Text>
          {post.platform === 'instagram' && !st.igConnected && <Chip label={t('Подключить Instagram')} onPress={onConnectInstagram} />}
        </View>}
        {similar.length > 0 && <View style={{ marginTop: 24 }}>
          <Text style={[styles.label, { color: c.sub }]}>{t('Похожие посты')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {similar.map(item => <Pressable key={item.id} onPress={() => onOpenPost?.(item.id)} style={[styles.simCard, { backgroundColor: c.card }]}>
              {(item.localImage || item.image) ? <Image source={{ uri: (item.localImage || item.image)! }} style={styles.simImg} contentFit="cover" /> : <View style={styles.simImg} />}
              <Text style={[styles.simTitle, { color: c.text }]} numberOfLines={2}>{cardTitle(item)}</Text>
            </Pressable>)}
          </ScrollView>
        </View>}
      </>} /> : <Modal visible onRequestClose={onClose}><View style={{ flex: 1, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={c.accent} /><IconBtn name="close" label={t('Закрыть')} onPress={onClose} /></View></Modal>}
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
  </>;
}

const styles = StyleSheet.create({
  help: { padding: 16, borderRadius: 18, marginTop: 20, gap: 12 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 12 },
  simCard: { width: 132, borderRadius: 16, overflow: 'hidden' },
  simImg: { width: 132, height: 96 },
  simTitle: { fontSize: 13, lineHeight: 18, fontWeight: '600', padding: 10 },
});
