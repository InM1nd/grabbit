// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubBreadcrumb, scrubEvent, scrubText } from '../src/core/sentryScrub';

test('scrubText strips urls/emails', () => {
  assert.equal(scrubText('fail https://instagram.com/p/abc?x=1 for a@b.co'), 'fail <url> for <email>');
});
test('breadcrumbs: console/http/navigation dropped, data removed', () => {
  assert.equal(scrubBreadcrumb({ category: 'console', message: 'caption' }), null);
  assert.equal(scrubBreadcrumb({ category: 'fetch', data: { url: 'x' } }), null);
  assert.equal(scrubBreadcrumb({ type: 'navigation' }), null);
  const b = scrubBreadcrumb({ category: 'app', message: 'see https://x.y/z', data: { caption: 'secret' } });
  assert.equal(b.data, undefined); assert.equal(b.message, 'see <url>');
});
test('event: user/request/extra removed, messages scrubbed', () => {
  const e = scrubEvent({ user: { id: '1', ip_address: '1.2.3.4' }, request: { url: 'https://a.b' }, extra: { caption: 'x' }, breadcrumbs: [1],
    exception: { values: [{ type: 'Error', value: 'bad https://t.me/x' }] }, contexts: { device: { name: 'Sasha phone', model: 'Pixel' } } });
  assert.equal(e.user, undefined); assert.equal(e.request, undefined); assert.equal(e.extra, undefined); assert.equal(e.breadcrumbs, undefined);
  assert.equal(e.exception.values[0].value, 'bad <url>');
  assert.equal(e.contexts.device.name, undefined); assert.equal(e.contexts.device.model, 'Pixel');
});
