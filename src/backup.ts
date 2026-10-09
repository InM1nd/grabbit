import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as db from './db';
import { emitDataChanged } from './events';

export interface BackupFile {
  app: 'pinbox';
  version: 1;
  exportedAt: string;
  boards: { name: string; emoji: string | null; createdAt: number }[];
  posts: {
    url: string; platform: string; title: string | null; description: string | null; author: string | null; image: string | null;
    aiTitle: string | null; summary: string | null; tags: string[]; note: string | null; board: string | null;
    createdAt: number; openedAt: number | null; rawText: string | null;
  }[];
}

export async function buildBackup(): Promise<BackupFile> {
  const boards = await db.listBoards();
  const byId = new Map(boards.map((b) => [b.id, b.name]));
  const posts = await db.listPosts();
  return {
    app: 'pinbox', version: 1, exportedAt: new Date().toISOString(),
    boards: boards.map((b) => ({ name: b.name, emoji: b.emoji, createdAt: b.createdAt })),
    posts: posts.map((p) => ({
      url: p.url, platform: p.platform, title: p.title, description: p.description, author: p.author, image: p.image,
      aiTitle: p.aiTitle, summary: p.summary, tags: p.tags, note: p.note, board: p.boardId ? byId.get(p.boardId) ?? null : null,
      createdAt: p.createdAt, openedAt: p.openedAt, rawText: p.rawText,
    })),
  };
}

/** Validate a parsed backup; throws a Russian message on bad input. */
export function validateBackup(x: any): BackupFile {
  if (!x || typeof x !== 'object' || !Array.isArray(x.posts)) throw new Error('Это не файл экспорта Pinbox');
  if (x.app !== 'pinbox' && x.app !== 'polka') throw new Error('Файл не от Pinbox');
  x.boards = Array.isArray(x.boards) ? x.boards : [];
  x.posts = x.posts.filter((p: any) => p && typeof p.url === 'string' && /^https?:\/\//.test(p.url));
  return x as BackupFile;
}

export async function exportBackup(): Promise<number> {
  const data = await buildBackup();
  const stamp = new Date().toISOString().slice(0, 10);
  const f = new File(Paths.cache, `pinbox-${stamp}.json`);
  if (f.exists) f.delete();
  f.create();
  f.write(JSON.stringify(data, null, 1));
  await Sharing.shareAsync(f.uri, { mimeType: 'application/json', dialogTitle: 'Экспорт Pinbox' });
  return data.posts.length;
}

/** Pick a JSON file and merge it: boards by name, posts by url (existing ones are kept). */
export async function importBackup(): Promise<{ added: number; skipped: number } | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/*', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.[0]) return null;
  const text = await new File(res.assets[0].uri).text();
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw new Error('Файл повреждён (не JSON)'); }
  const data = validateBackup(parsed);
  const d = await db.getDb();
  const boardIds = new Map<string, number>();
  for (const b of data.boards) boardIds.set(b.name.toLowerCase(), await db.getOrCreateBoard(b.name, b.emoji));
  let added = 0, skipped = 0;
  for (const p of data.posts) {
    if (await db.findPostByUrl(p.url)) { skipped++; continue; }
    let boardId: number | null = null;
    if (p.board) boardId = boardIds.get(p.board.toLowerCase()) ?? (await db.getOrCreateBoard(p.board));
    const done = !!p.summary;
    await d.runAsync(
      `INSERT INTO posts (url, raw_text, platform, title, description, author, image, meta_fetched, ai_title, summary, tags, note, board_id, status, created_at, opened_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.url, p.rawText ?? null, p.platform || 'web', p.title ?? null, p.description ?? null, p.author ?? null, p.image ?? null,
      p.aiTitle ?? null, p.summary ?? null, JSON.stringify(p.tags || []), p.note ?? null, boardId, done ? 'done' : 'pending',
      p.createdAt || Date.now(), p.openedAt ?? null,
    );
    added++;
  }
  emitDataChanged();
  return { added, skipped };
}
