import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as db from './db';
import { emitDataChanged } from './events';
import { readSummarySources, type DetailSource, type SummarySource } from './core/analysisSources';
import { t } from './i18n';
import { listPostReminders, schedulePostReminder } from './reminders';

export interface BackupFile {
  app: 'pinbox' | 'polka';
  version: 1 | 2;
  exportedAt: string;
  boards: { name: string; emoji: string | null; createdAt: number }[];
  posts: {
    url: string; platform: string; title: string | null; description: string | null; author: string | null; image: string | null;
    aiTitle: string | null; summary: string | null; tags: string[]; note: string | null; board: string | null;
    summarySources?: SummarySource[]; detailedSummary?: string | null; detailSource?: DetailSource | null;
    createdAt: number; openedAt: number | null; rawText: string | null;
    mark?: db.PostMark | null; remindedAt?: number | null; remindAt?: number | null;
  }[];
}

export async function buildBackup(): Promise<BackupFile> {
  const boards = await db.listBoards();
  const byId = new Map(boards.map((b) => [b.id, b.name]));
  const posts = await db.listPosts();
  const reminders = await listPostReminders();
  return {
    app: 'pinbox', version: 2, exportedAt: new Date().toISOString(),
    boards: boards.map((b) => ({ name: b.name, emoji: b.emoji, createdAt: b.createdAt })),
    posts: posts.map((p) => ({
      url: p.url, platform: p.platform, title: p.title, description: p.description, author: p.author, image: p.image,
      aiTitle: p.aiTitle, summary: p.summary, tags: p.tags, note: p.note, board: p.boardId ? byId.get(p.boardId) ?? null : null,
      summarySources: p.summarySources, detailedSummary: p.detailedSummary, detailSource: p.detailSource,
      createdAt: p.createdAt, openedAt: p.openedAt, rawText: p.rawText,
      mark: p.mark, remindedAt: p.remindedAt, remindAt: reminders.get(p.id) ?? null,
    })),
  };
}

/** Validate a parsed backup; throws a Russian message on bad input. */
export function validateBackup(x: any): BackupFile {
  if (!x || typeof x !== 'object' || !Array.isArray(x.posts)) throw new Error(t('Это не файл экспорта Grabbit'));
  if (x.app !== 'pinbox' && x.app !== 'polka') throw new Error(t('Файл не от Grabbit'));
  if (x.version != null && x.version !== 1 && x.version !== 2) throw new Error(t('Версия резервной копии не поддерживается'));
  const timestamp = (n: unknown) => n == null || (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 8.64e15);
  const invalid = () => { throw new Error(t('Это не файл экспорта Grabbit')); };
  const boards = Array.isArray(x.boards) ? x.boards : [];
  for (const b of boards) {
    if (!b || typeof b.name !== 'string' || !b.name.trim() || (b.emoji != null && typeof b.emoji !== 'string') || !timestamp(b.createdAt)) invalid();
  }
  const posts = x.posts.filter((p: any) => p && typeof p.url === 'string' && /^https?:\/\//.test(p.url));
  for (const p of posts) {
    for (const key of ['platform', 'title', 'description', 'author', 'image', 'aiTitle', 'summary', 'note', 'board', 'rawText']) {
      if (p[key] != null && typeof p[key] !== 'string') invalid();
    }
    if (p.tags != null && (!Array.isArray(p.tags) || p.tags.some((tag: unknown) => typeof tag !== 'string'))) invalid();
    if (p.mark != null && !db.MARKS.includes(p.mark)) invalid();
    for (const key of ['createdAt', 'openedAt', 'remindedAt', 'remindAt']) if (!timestamp(p[key])) invalid();
  }
  return { ...x, version: x.version ?? 1, boards, posts } as BackupFile;
}

export async function exportBackup(): Promise<number> {
  const data = await buildBackup();
  const stamp = new Date().toISOString().slice(0, 10);
  const f = new File(Paths.cache, `pinbox-${stamp}.json`);
  if (f.exists) f.delete();
  f.create();
  f.write(JSON.stringify(data, null, 1));
  await Sharing.shareAsync(f.uri, { mimeType: 'application/json', dialogTitle: t('Экспорт Grabbit') });
  return data.posts.length;
}

/** Pick a JSON file and merge it: boards by name, posts by url (existing ones are kept). */
export async function importBackup(): Promise<RestoreResult | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/*', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return null;
  const text = await new File(res.assets[0].uri).text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw new Error(t('Файл повреждён (не JSON)')); }
  return restoreBackup(parsed);
}

export interface RestoreResult { added: number; skipped: number; remindersRestored: number; remindersFailed: number }

/** Merge validated data; notification failures must not hide successful data restoration. */
export async function restoreBackup(input: unknown): Promise<RestoreResult> {
  const data = validateBackup(input);
  const d = await db.getDb();
  const boardIds = new Map<string, number>();
  const existingBoards = new Set((await db.listBoards()).map((b) => b.id));
  for (const b of data.boards) {
    const id = await db.getOrCreateBoard(b.name, b.emoji);
    boardIds.set(b.name.toLowerCase(), id);
    if (!existingBoards.has(id) && b.createdAt != null) {
      await d.runAsync('UPDATE boards SET created_at = ? WHERE id = ?', b.createdAt, id);
      existingBoards.add(id);
    }
  }
  for (const p of data.posts) {
    if (p.board && !boardIds.has(p.board.toLowerCase())) boardIds.set(p.board.toLowerCase(), await db.getOrCreateBoard(p.board));
  }
  let added = 0, skipped = 0;
  const reminders: { id: number; at: number }[] = [];
  await d.withExclusiveTransactionAsync(async (tx) => {
    for (const p of data.posts) {
      if (await tx.getFirstAsync('SELECT id FROM posts WHERE url = ?', p.url)) { skipped++; continue; }
      const boardId = p.board ? boardIds.get(p.board.toLowerCase()) ?? null : null;
      const done = !!p.summary;
      const result = await tx.runAsync(
        `INSERT INTO posts (url, raw_text, platform, title, description, author, image, meta_fetched, ai_title, summary, tags, note, board_id, status, created_at, opened_at, summary_sources, detailed_summary, detail_source, mark, reminded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.url, p.rawText ?? null, p.platform || 'web', p.title ?? null, p.description ?? null, p.author ?? null, p.image ?? null,
        p.aiTitle ?? null, p.summary ?? null, JSON.stringify(p.tags || []), p.note ?? null, boardId, done ? 'done' : 'pending',
        p.createdAt ?? Date.now(), p.openedAt ?? null, JSON.stringify(readSummarySources(p.summarySources) ?? null),
        typeof p.detailedSummary === 'string' ? p.detailedSummary : null,
        p.detailSource === 'article' || p.detailSource === 'transcript' ? p.detailSource : null,
        p.mark ?? null, p.remindedAt ?? null,
      );
      if (p.remindAt != null && p.remindAt > Date.now()) reminders.push({ id: Number(result.lastInsertRowId), at: p.remindAt });
      added++;
    }
  });
  let remindersRestored = 0, remindersFailed = 0;
  for (const reminder of reminders) {
    try {
      const post = await db.getPost(reminder.id);
      if (post && await schedulePostReminder(post, reminder.at)) remindersRestored++;
      else remindersFailed++;
    } catch { remindersFailed++; }
  }
  emitDataChanged();
  return { added, skipped, remindersRestored, remindersFailed };
}
