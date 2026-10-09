// @ts-nocheck — dev-only smoke test run with tsx
// Runs IG_INJECT_JS in headless Chrome (logged OUT) to verify the script executes and its output parses.
import { createRequire } from 'node:module';
import { IG_INJECT_JS, extractInstagram } from '../src/core/igExtract';
const require = createRequire('/workspace/tools/package.json');
const puppeteer = require('puppeteer-core');
(async () => {
  const url = process.argv[2] || 'https://www.instagram.com/reel/DdBtNAvhuoP/';
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36');
  let msg: string | null = null;
  await p.exposeFunction('__post', (s: string) => { msg = s; });
  await p.evaluateOnNewDocument('window.ReactNativeWebView={postMessage:function(s){window.__post(s)}}');
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
  await p.evaluate(IG_INJECT_JS);
  for (let i = 0; i < 30 && !msg; i++) await new Promise((r) => setTimeout(r, 500));
  await b.close();
  if (!msg) { console.log('NO MESSAGE'); process.exit(1); }
  const raw = JSON.parse(msg);
  console.log('message ok: url=%s loggedIn=%s api=%s html=%d dom.h1=%s imgs=%d', raw.url, raw.loggedIn, raw.api ? raw.api.length : null, raw.html?.length, JSON.stringify(raw.dom?.h1)?.slice(0, 60), raw.dom?.imgs?.length);
  const r = extractInstagram(raw);
  console.log('extract:', r ? { ...r, caption: r.caption?.slice(0, 100), image: r.image?.slice(0, 60) } : null);
})();
