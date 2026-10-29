// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, fetchLatest, fromGithubRelease, fromManifest, pickSource, UpdateError } from '../src/core/release';

test('compareVersions', () => {
  assert.ok(compareVersions('1.2.0', '1.1.0') > 0);
  assert.ok(compareVersions('v1.10.0', '1.9.9') > 0);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.ok(compareVersions('1.1.0', '1.2.0') < 0);
});

const rel = { tag_name: 'v1.2.0', body: 'notes', html_url: 'https://github.com/x/y/releases/tag/v1.2.0',
  assets: [{ name: 'a.txt', url: 'u0' }, { name: 'Pinbox-v1.2.0.apk', url: 'https://api.github.com/repos/x/y/releases/assets/1', browser_download_url: 'https://github.com/x/y/releases/download/v1.2.0/Pinbox-v1.2.0.apk', size: 15000000 }] };

test('fromGithubRelease picks the apk', () => {
  const a = fromGithubRelease(rel, true);
  assert.equal(a.version, '1.2.0'); assert.equal(a.needsAuth, true); assert.match(a.apkUrl, /assets\/1$/);
  assert.match(fromGithubRelease(rel, false).apkUrl, /download/);
  assert.equal(fromGithubRelease({ tag_name: 'v1', assets: [] }, false), null);
});

test('manifest + source selection', () => {
  assert.equal(fromManifest({ version: '1.3.0', apkUrl: 'https://e.com/p.apk' }).apkName, 'p.apk');
  assert.equal(fromManifest({ version: '1.3.0', apkUrl: 'http://insecure' }), null);
  assert.equal(pickSource({}).kind, 'github-public');
  assert.equal(pickSource({ updateToken: 'x' }).kind, 'github-token');
  assert.equal(pickSource({ updateToken: 'x', updateManifestUrl: 'https://m' }).kind, 'manifest');
});

test('public releases API without token (live; not-configured while the repo is private)', async () => {
  try {
    const info = await fetchLatest({ kind: 'github-public', repo: 'InM1nd/polka' });
    assert.match(info.version, /^\d+\.\d+\.\d+$/); assert.equal(info.needsAuth, false); assert.match(info.apkName, /\.apk$/);
  } catch (e) {
    assert.ok(e instanceof UpdateError && ['not-configured', 'network'].includes(e.code), String(e));
  }
});

test('with a token → latest release with APK asset (live, read-only GET)', { skip: !process.env.UPDATE_TEST_TOKEN }, async () => {
  const info = await fetchLatest({ kind: 'github-token', repo: 'InM1nd/polka', token: process.env.UPDATE_TEST_TOKEN });
  assert.match(info.version, /^\d+\.\d+\.\d+$/); assert.equal(info.needsAuth, true); assert.match(info.apkName, /\.apk$/);
  // asset download: follow redirect with auth stripped (like OkHttp) and read the first bytes
  const r1 = await fetch(info.apkUrl, { headers: { Accept: 'application/octet-stream', Authorization: `Bearer ${process.env.UPDATE_TEST_TOKEN}` }, redirect: 'manual' });
  assert.ok([301, 302, 307].includes(r1.status), 'redirect ' + r1.status);
  const r2 = await fetch(r1.headers.get('location'), { headers: { Range: 'bytes=0-3' } });
  const b = new Uint8Array(await r2.arrayBuffer());
  assert.deepEqual([...b.slice(0, 2)], [0x50, 0x4b]); // "PK" zip header
});
