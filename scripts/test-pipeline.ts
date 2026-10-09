// Usage: GEMINI_API_KEY=... npx tsx scripts/test-pipeline.ts [--no-ai] [urls...]
import { fetchMetadata } from '../src/core/metadata';
import { analyzePost, isWeakText, sniffMime } from '../src/core/ai';
import { extractUrl, extraText, normalizeUrl } from '../src/core/url';

const DEFAULT = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtube.com/shorts/tPEE9ZwTmy0?si=abc',
  'https://www.tiktok.com/@scout2015/video/6718335390845095173',
  'https://x.com/OpenAI/status/1745554215133733208',
  'https://www.reddit.com/r/LocalLLaMA/comments/1b2y5x0/',
  'https://www.instagram.com/p/C3xYqZPMu2B/',
  'https://www.instagram.com/reel/DAhY1yWv2rC/?igsh=MWZ4',
  'Смотри какая штука! https://github.com/expo/expo',
  'https://www.theverge.com/ai-artificial-intelligence',
];

const args = process.argv.slice(2);
const noAi = args.includes('--no-ai');
const forceVision = args.includes('--vision');
const noteArg = args.find((a: string) => a.startsWith('--note='))?.slice(7);
const inputs = args.filter((a: string) => !a.startsWith('--'));
async function fetchImage(url: string) {
  try { const r = await fetch(url); if (!r.ok) return undefined; const u8 = new Uint8Array(await r.arrayBuffer()); let bin = ''; for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000)); const data = btoa(bin); return { mimeType: sniffMime(data), data }; } catch { return undefined; }
}
const key = (process.env.GEMINI_API_KEY || '').trim();
const boards: string[] = [];

(async () => {
  for (const raw of inputs.length ? inputs : DEFAULT) {
    const url = extractUrl(raw);
    if (!url) { console.log('no url in', raw); continue; }
    const norm = normalizeUrl(url);
    const t0 = Date.now();
    const meta = await fetchMetadata(norm);
    const dt = Date.now() - t0;
    console.log(`\n=== ${norm}  [${meta.platform} via ${meta.source}${meta.blocked ? ', BLOCKED' : ''}, ${dt}ms]`);
    console.log('  title:', meta.title?.slice(0, 100));
    console.log('  desc :', meta.description?.slice(0, 140));
    console.log('  image:', meta.image ? meta.image.slice(0, 90) + '…' : '-');
    if (noAi) continue;
    if (meta.unavailable) console.log('  UNAVAILABLE: platform says post is not public');
    try {
      const sharedText = extraText(raw, url);
      const weak = isWeakText(meta, sharedText, noteArg);
      const image = meta.image && (weak || forceVision) ? await fetchImage(meta.image) : undefined;
      console.log(`  weakText=${weak} vision=${!!image}${noteArg ? ' note=yes' : ''}`);
      const ai = await analyzePost({ meta, sharedText, boards, image, note: noteArg }, key);
      if (!boards.includes(ai.board)) boards.push(ai.board);
      console.log(`  AI(${ai.model}): [${ai.boardEmoji ?? ''} ${ai.board}] ${ai.title}`);
      console.log('    ', ai.summary);
      console.log('     #' + ai.tags.join(' #'));
    } catch (e: any) {
      console.log('  AI ERROR:', e.message, 'retryable=', e.retryable);
    }
  }
  console.log('\nBoards:', boards);
})();
