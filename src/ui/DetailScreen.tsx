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
import { C, PLATFORM_COLOR, PLATFORM_ICON, timeAgo } from '../theme';
import { thumbAspect } from './PostCard';
import { PromptModal } from './PromptModal';

interface Props { postId: number | null; boards: db.Board[]; onClose: () => void; toast: (msg: string) => void }

export function DetailScreen({ postId, boards, onClose, toast }: Props) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [post, setPost] = useState<db.Post | null>(null);
  const [showDesc, setShowDesc] = useState(false);
  const [pickBoard, setPickBoard] = useState(false);
  const [newBoard, setNewBoard] = useState(false);
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

  const visible = postId != null;
  const board = post?.boardId ? boards.find((b) => b.id === post.boardId) : undefined;
  const img = post ? post.localImage || post.image : null;

  const openOriginal = async () => {
    if (!post) return;
    try { await Linking.openURL(post.url); } catch { toast('Не удалось открыть ссылку'); }
  };
  const remove = () => {
    if (!post) return;
    Alert.alert('Удалить пост?', 'Он пропадёт из ленты и досок.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: async () => { deleteThumb(post.id); await db.deletePost(post.id); onClose(); toast('Удалено'); } },
    ]);
  };
  const setBoard = async (id: number | null) => { if (post) await db.updatePost(post.id, { board_id: id }); setPickBoard(false); };
  const addTag = async () => {
    const t = tagInput.trim().toLowerCase().replace(/^#/, '');
    if (!post || !t) return;
    if (!post.tags.includes(t)) await db.updatePost(post.id, { tags: [...post.tags, t] });
    setTagInput('');
  };
  const removeTag = async (t: string) => { if (post) await db.updatePost(post.id, { tags: post.tags.filter((x) => x !== t) }); };
  const redo = async () => {
    if (!post) return;
    setBusy(true);
    await db.updatePost(post.id, { board_id: null });
    await reprocess(post.id, true);
    setBusy(false);
    const p = await db.getPost(post.id);
    toast(p?.status === 'done' ? 'ИИ обновил описание' : 'Не получилось — попробую позже');
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}><Ionicons name="chevron-back" size={24} color={C.text} /></Pressable>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => post && Share.share({ message: post.url })} hitSlop={10} style={styles.iconBtn}><Ionicons name="share-social-outline" size={21} color={C.text} /></Pressable>
          <Pressable onPress={remove} hitSlop={10} style={styles.iconBtn}><Ionicons name="trash-outline" size={21} color={C.text} /></Pressable>
        </View>
        {!post ? <ActivityIndicator style={{ marginTop: 40 }} color={C.accent} /> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} keyboardShouldPersistTaps="handled">
            {img ? (
              <Pressable onPress={openOriginal} style={{ paddingHorizontal: 12 }}>
                <Image source={{ uri: img }} style={{ width: width - 24, height: Math.min((width - 24) / thumbAspect(post), 520), borderRadius: 20, backgroundColor: C.chip }} contentFit="cover" />
                <View style={styles.playHint}><Ionicons name="open-outline" size={14} color="#fff" /><Text style={styles.playHintText}>Открыть в {PLATFORM_LABEL[post.platform]}</Text></View>
              </Pressable>
            ) : null}
            <View style={styles.content}>
              <View style={styles.metaRow}>
                <View style={[styles.platform, { backgroundColor: PLATFORM_COLOR[post.platform] }]}>
                  <Ionicons name={PLATFORM_ICON[post.platform] as any} size={12} color="#fff" />
                  <Text style={styles.platformText}>{PLATFORM_LABEL[post.platform]}</Text>
                </View>
                {!!post.author && <Text style={styles.author} numberOfLines={1}>{post.author}</Text>}
                <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
              </View>
              <Text style={styles.title} selectable>{post.aiTitle || post.title || post.url}</Text>

              {post.status === 'pending' ? (
                <View style={styles.aiBox}><ActivityIndicator color={C.accent} /><Text style={styles.aiPending}>ИИ разбирает пост…{post.lastError ? `\n(повторю позже: ${post.lastError})` : ''}</Text></View>
              ) : post.summary ? (
                <View style={styles.aiBox}>
                  <Ionicons name="sparkles" size={16} color={C.accent} style={{ marginTop: 2 }} />
                  <Text style={styles.summary} selectable>{post.summary}</Text>
                </View>
              ) : (
                <View style={styles.aiBox}><Ionicons name="alert-circle-outline" size={16} color={C.warn} /><Text style={styles.aiPending}>ИИ не смог описать пост{post.lastError ? `: ${post.lastError}` : ''}</Text></View>
              )}

              <Text style={styles.label}>Доска</Text>
              <Pressable onPress={() => setPickBoard(true)} style={styles.boardBtn}>
                <Text style={styles.boardBtnText}>{board ? `${board.emoji ?? '📌'}  ${board.name}` : 'Выбрать доску'}</Text>
                <Ionicons name="chevron-down" size={18} color={C.sub} />
              </Pressable>

              <Text style={styles.label}>Теги</Text>
              <View style={styles.tags}>
                {post.tags.map((t) => (
                  <Pressable key={t} onLongPress={() => removeTag(t)} style={styles.tag}>
                    <Text style={styles.tagText}>#{t}</Text>
                    <Pressable hitSlop={8} onPress={() => removeTag(t)}><Ionicons name="close" size={14} color={C.sub} /></Pressable>
                  </Pressable>
                ))}
                <View style={[styles.tag, { paddingRight: 4 }]}>
                  <TextInput value={tagInput} onChangeText={setTagInput} placeholder="+ тег" placeholderTextColor={C.faint} style={styles.tagInput} onSubmitEditing={addTag} returnKeyType="done" blurOnSubmit={false} />
                </View>
              </View>

              {!!post.description && (
                <>
                  <Pressable onPress={() => setShowDesc(!showDesc)} style={styles.descHead}>
                    <Text style={styles.label}>Оригинальный текст</Text>
                    <Ionicons name={showDesc ? 'chevron-up' : 'chevron-down'} size={16} color={C.faint} style={{ marginTop: 18 }} />
                  </Pressable>
                  <Text style={styles.desc} numberOfLines={showDesc ? undefined : 4} selectable>{post.description}</Text>
                </>
              )}
              {post.metaBlocked && (
                <Text style={styles.blocked}>Сайт не отдал превью — описание сделано по ссылке{post.rawText ? ' и тексту, который пришёл при «Поделиться»' : ''}.</Text>
              )}

              <Pressable onPress={async () => { await Clipboard.setStringAsync(post.url); toast('Ссылка скопирована'); }}>
                <Text style={styles.url} numberOfLines={2}>{post.url}</Text>
              </Pressable>

              <Pressable onPress={redo} disabled={busy} style={styles.secondary}>
                {busy ? <ActivityIndicator color={C.accent} /> : <><Ionicons name="refresh" size={16} color={C.accent} /><Text style={styles.secondaryText}>Переописать с ИИ</Text></>}
              </Pressable>
            </View>
          </ScrollView>
        )}
        {post && (
          <View style={[styles.bottom, { paddingBottom: 12 + insets.bottom }]}>
            <Pressable onPress={openOriginal} style={styles.primary}>
              <Ionicons name="open-outline" size={18} color="#fff" />
              <Text style={styles.primaryText}>Открыть оригинал</Text>
            </Pressable>
          </View>
        )}
      </View>

      <Modal visible={pickBoard} transparent animationType="fade" onRequestClose={() => setPickBoard(false)} statusBarTranslucent>
        <Pressable style={styles.sheetBackdrop} onPress={() => setPickBoard(false)}>
          <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
            <Text style={styles.sheetTitle}>Переложить на доску</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {boards.map((b) => (
                <Pressable key={b.id} onPress={() => setBoard(b.id)} style={styles.sheetRow}>
                  <Text style={styles.sheetRowText}>{b.emoji ?? '📌'}  {b.name}</Text>
                  {post?.boardId === b.id && <Ionicons name="checkmark" size={20} color={C.accent} />}
                </Pressable>
              ))}
              <Pressable onPress={() => { setPickBoard(false); setNewBoard(true); }} style={styles.sheetRow}>
                <Text style={[styles.sheetRowText, { color: C.accent }]}>＋  Новая доска</Text>
              </Pressable>
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
      <PromptModal
        visible={newBoard}
        title="Новая доска"
        placeholder="Название"
        onCancel={() => setNewBoard(false)}
        onOk={async (v) => { const id = await db.getOrCreateBoard(v); await setBoard(id); setNewBoard(false); }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, height: 52 },
  iconBtn: { padding: 10 },
  playHint: { position: 'absolute', left: 24, bottom: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 },
  playHintText: { color: '#fff', fontSize: 12.5, marginLeft: 5, fontWeight: '500' },
  content: { paddingHorizontal: 18, paddingTop: 14 },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  platform: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  platformText: { color: '#fff', fontSize: 12, fontWeight: '600', marginLeft: 4 },
  author: { marginLeft: 8, color: C.sub, fontSize: 13, flexShrink: 1 },
  time: { marginLeft: 'auto', color: C.faint, fontSize: 12, paddingLeft: 8 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', color: C.text, marginTop: 12 },
  aiBox: { flexDirection: 'row', gap: 10, backgroundColor: C.card, borderRadius: 16, padding: 14, marginTop: 14, alignItems: 'flex-start' },
  summary: { flex: 1, fontSize: 15.5, lineHeight: 22, color: C.text },
  aiPending: { flex: 1, color: C.sub, fontSize: 14, lineHeight: 20 },
  label: { fontSize: 12.5, fontWeight: '700', color: C.faint, textTransform: 'uppercase', marginTop: 20, marginBottom: 8 },
  boardBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.card, borderRadius: 14, paddingHorizontal: 14, height: 48, borderWidth: 1, borderColor: C.line },
  boardBtnText: { fontSize: 15.5, color: C.text, fontWeight: '500' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.chip, borderRadius: 16, paddingLeft: 12, paddingRight: 10, height: 32 },
  tagText: { fontSize: 13.5, color: C.text },
  tagInput: { minWidth: 70, fontSize: 13.5, color: C.text, paddingVertical: 0 },
  descHead: { flexDirection: 'row', justifyContent: 'space-between' },
  desc: { fontSize: 14, lineHeight: 20, color: C.sub },
  blocked: { fontSize: 12.5, color: C.faint, marginTop: 14, lineHeight: 17 },
  url: { fontSize: 12.5, color: C.faint, marginTop: 18, textDecorationLine: 'underline' },
  secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 20, height: 44, borderRadius: 14, backgroundColor: C.accentSoft },
  secondaryText: { color: C.accent, fontWeight: '600', fontSize: 14.5 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, backgroundColor: 'rgba(250,247,245,0.96)' },
  primary: { height: 52, borderRadius: 16, backgroundColor: C.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 8, paddingHorizontal: 4 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  sheetRowText: { fontSize: 16, color: C.text },
});
