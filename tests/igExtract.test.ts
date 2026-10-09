import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractInstagram, fromOgTags, igShortcode, shortcodeToMediaId, sliceJsonValue } from '../src/core/igExtract';
import { normalizeUrl } from '../src/core/url';

const fx = (f: string) => readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8');

test('shortcode → media id matches Instagram (real pair from embed page)', () => {
  assert.equal(shortcodeToMediaId('DdBtNAvhuoP'), '3981662351815797263');
});

test('dlrf/igsh params are stripped and shortcode parsed', () => {
  const u = normalizeUrl('https://www.instagram.com/reel/DdO-IIyioOy/?dlrf=MTV1M3d3NXAyb2M5OQ==&igsh=abc');
  assert.equal(u, 'https://www.instagram.com/reel/DdO-IIyioOy/');
  assert.equal(igShortcode(u), 'DdO-IIyioOy');
  assert.equal(igShortcode('https://www.instagram.com/someuser/p/AbC_12-x/'), 'AbC_12-x');
});

test('v1 media/info API JSON (logged-in fetch)', () => {
  const r = extractInstagram({ url: 'https://www.instagram.com/reel/DdO-IIyioOy/', api: fx('ig-api-info.json') });
  assert.equal(r?.source, 'api');
  assert.match(r!.caption!, /ИИ-монтажёр/);
  assert.equal(r?.author, '@techbro.ai');
  assert.equal(r?.image, 'https://scontent.cdninstagram.com/v/t51/thumb_1080.jpg');
});

test('embedded xdt JSON in logged-in HTML picks the right shortcode', () => {
  const r = extractInstagram({ url: 'https://www.instagram.com/p/DdO-IIyioOy/', html: fx('ig-loggedin-embedded.html'), api: '<html>login</html>' });
  assert.equal(r?.source, 'embedded-json');
  assert.match(r!.caption!, /5 бесплатных "AI" сервисов/);
  assert.equal(r?.author, '@design.lab');
  assert.equal(r?.image, 'https://scontent.cdninstagram.com/v/carousel_0.jpg');
});

test('og tags of a real public reel page', () => {
  const r = fromOgTags(fx('ig-public-reel-og.html'));
  assert.equal(r?.author, '@varindia');
  assert.match(r!.caption!, /^Thousands of AI agents linked to OpenAI/);
  assert.match(r!.image!, /cdninstagram\.com/);
});

test('real "unavailable" page yields nothing (no false positives)', () => {
  const r = extractInstagram({ url: 'https://www.instagram.com/reel/DdO-IIyioOy/', html: fx('ig-unavailable-reel.html') });
  assert.equal(r, null);
});

test('DOM fallback (rendered h1 + large cdn image)', () => {
  const r = extractInstagram({ url: 'https://www.instagram.com/p/X/', html: '<html></html>', dom: { h1: 'Подпись из h1', imgs: [{ src: 'https://scontent.cdninstagram.com/a.jpg', alt: 'Photo by x', w: 1080 }, { src: 'https://x/avatar.jpg', alt: '', w: 150 }] } });
  assert.equal(r?.source, 'dom');
  assert.equal(r?.caption, 'Подпись из h1');
  assert.equal(r?.image, 'https://scontent.cdninstagram.com/a.jpg');
});

test('sliceJsonValue handles strings with brackets/escapes', () => {
  const t = 'x "k":{"a":"}{]\\"[","b":[1,{"c":2}]} tail';
  assert.equal(sliceJsonValue(t, t.indexOf(':') + 1), '{"a":"}{]\\"[","b":[1,{"c":2}]}');
});
