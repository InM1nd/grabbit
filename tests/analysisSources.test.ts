import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detailedPrompt } from '../src/core/ai';
import { readSummarySources, summarySources } from '../src/core/analysisSources';
import { extractArticleText } from '../src/core/metadata';
import type { Metadata } from '../src/core/types';

test('source labels distinguish a supplied screenshot, an actual cover and unavailable content', () => {
  const meta: Metadata = { url: 'https://example.com/', platform: 'web', title: 'Login', blocked: true, source: 'test' };
  assert.deepEqual(summarySources({ meta }), []);
  assert.deepEqual(summarySources({ meta, note: 'My note', image: {}, shot: true }), ['note', 'screenshot']);
  assert.deepEqual(summarySources({ meta: { ...meta, blocked: false, description: 'Caption' }, image: {} }), ['caption', 'cover', 'title']);
  assert.deepEqual(readSummarySources(['note', 'x', 'note']), ['note']);
  assert.equal(readSummarySources(null), undefined);
});

test('the detailed prompt retains supplied timestamps and stays within the proxy budget', () => {
  const prompt = detailedPrompt('00:35 A measurable result. ' + 'a'.repeat(20000), 'transcript', 'en');
  assert.ok(prompt.includes('00:35 A measurable result.'));
  assert.ok(prompt.length < 11000);
});

test('article extraction reads headings and paragraphs while ignoring navigation and script text', () => {
  const body = 'A real paragraph with enough context to summarize the author’s material. '.repeat(4);
  const page = '<nav><p>Ads outside</p></nav><article><script>Ads inside</script><h1>How it works</h1><p>' + body + '</p></article>';
  assert.match(extractArticleText(page) ?? '', /^How it works\nA real paragraph/);
  assert.doesNotMatch(extractArticleText(page) ?? '', /Ads/);
  assert.equal(extractArticleText('<body><p>' + body + '</p></body>'), null);
});
