// @ts-nocheck
// Calibrate the embedding fallback (EMBED_PICK / EMBED_PICK_CENTERED in src/core/sorting.ts) on your own posts.
//
//   GEMINI_API_KEY=... npx tsx scripts/embed-calibrate.mts samples.json
//
// samples.json: { "boards": { "Programming": ["post text", ...], "AI tools": [...], ... }, "offTopic": ["text", ...] }
// Use 5+ real posts per board (title + summary + tags, like embedText() builds) and a few posts that fit none.
// Uses your own key directly (not the Grabbit proxy), so it does not touch the proxy's per-device limits.
// One batchEmbedContents request in total (≤ 100 texts). Prints, for each setting, how many posts would be
// placed on the right board / on a wrong one / left alone, and how many off-topic posts would be taken by mistake.
import { readFileSync } from 'node:fs';
import { embedTexts, normalize } from '../src/core/embed';
import { centroid, EMBED_PICK, EMBED_PICK_CENTERED, pickBoard, prepareBoardVectors, type BoardVector, type PickOpts } from '../src/core/sorting';

const key = process.env.GEMINI_API_KEY;
const file = process.argv[2];
if (!key || !file) { console.error('usage: GEMINI_API_KEY=... npx tsx scripts/embed-calibrate.mts samples.json'); process.exit(1); }
const data: { boards: Record<string, string[]>; offTopic?: string[] } = JSON.parse(readFileSync(file, 'utf8'));
const names = Object.keys(data.boards);
const items = names.flatMap((n, b) => data.boards[n].map((text) => ({ b, text })));
const off = data.offTopic ?? [];
if (items.length + off.length > 100) { console.error('too many texts for one request (max 100)'); process.exit(1); }

const vecs = await embedTexts([...items.map((x) => x.text), ...off], key, 'RETRIEVAL_DOCUMENT', 60_000);
const vOf = items.map((x, i) => ({ b: x.b, v: vecs[i] }));
const vOff = vecs.slice(items.length);

function evaluate(centered: boolean, opts: PickOpts) {
  let right = 0, wrong = 0, none = 0, offHit = 0;
  const cands = (skip?: number): BoardVector[] => names.map((_, b) => ({ id: b, kind: 'centroid' as const, vec: centroid(vOf.filter((x, i) => x.b === b && i !== skip).map((x) => x.v))! })).filter((c) => c.vec);
  const prepFor = (c: BoardVector[]) => (centered ? prepareBoardVectors(c) : { cands: c.map((x) => ({ ...x, vec: normalize(x.vec) })), centered: false, mean: null });
  vOf.forEach((x, i) => { // leave-one-out: the post must not be part of its own board's centroid
    const p = pickBoard(x.v, prepFor(cands(i)), opts);
    if (!p) none++; else if (p.id === x.b) right++; else wrong++;
  });
  const all = prepFor(cands());
  for (const v of vOff) if (pickBoard(v, all, opts)) offHit++;
  return { right, wrong, none, offHit, of: vOf.length };
}

const row = (label: string, r: ReturnType<typeof evaluate>) =>
  console.log(label.padEnd(34), `right ${r.right}/${r.of}  wrong ${r.wrong}  left ${r.none}  off-topic taken ${r.offHit}/${vOff.length}`);

console.log(`${names.length} boards, ${items.length} posts, ${off.length} off-topic\n`);
row('raw  (1.10.0 thresholds)', evaluate(false, EMBED_PICK));
row('centered (1.10.1 defaults)', evaluate(true, EMBED_PICK_CENTERED));
for (const margin of [0.03, 0.045, 0.06, 0.08, 0.1]) for (const floor of [0.15, 0.25, 0.35]) {
  row(`centered margin ${margin} floor ${floor}`, evaluate(true, { ...EMBED_PICK_CENTERED, margin, centroidFloor: floor }));
}
console.log('\nPick the row with "wrong" and "off-topic taken" near 0 and the most "right", then set it in EMBED_PICK_CENTERED.');
