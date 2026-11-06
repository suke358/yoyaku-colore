// colore の HP の予約欄を、テスト用の予約システムで自動で押すテスト（Playwright。2026/11/03）
//   npm run e2e-hp   （= node test-kankyou/e2e_hp.mjs）　HP の場所を変えるときは  node test-kankyou/e2e_hp.mjs --hp ../colore-website
// たどる流れ：HP を開く → メニュー → 日付 → 時間 → 入力 → 確認画面 → 予約する → 送ったつもりのメール 2 通 → メールのリンクで取り消す
//           → HP の「予約ページで開く」「確認・取り消し」の行き先がテスト用 → HP から本番への通信が 1 つもない → HP のファイルが 1 つも変わっていない
// 本人の予約表（start.mjs の .state）とは別の場所・別のポート（予約 8796・メール係 8795・HP 8797）。毎回まっさら
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { startAll, jstDate } from './kankyou.mjs';
import { startHp, DEFAULT_HP_DIR, PROD_ORIGIN } from './hp.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('Playwright が入っていません。クラウド側で回すか、npm i --no-save playwright && npx playwright install chromium で入れてください');
  process.exit(2);
}

const argv = process.argv.slice(2);
const hpAt = argv.indexOf('--hp');
const HP_DIR = path.resolve(hpAt >= 0 && argv[hpAt + 1] ? argv[hpAt + 1] : (process.env.HP_DIR || DEFAULT_HP_DIR));
const PORT = 8796, GAS_PORT = 8795, HP_PORT = 8797, PW = 'test-admin-1103';
const PROD_HOST = new URL(PROD_ORIGIN).hostname;
const STATE = mkdtempSync(path.join(os.tmpdir(), 'yoyaku-e2e-hp-'));
const results = [];
let failed = 0;
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push('✓ ' + name + '（' + ((Date.now() - t0) / 1000).toFixed(1) + '秒）'); console.log('✓ ' + name); }
  catch (e) { failed++; results.push('✗ ' + name + '：' + String(e && e.message || e).split('\n')[0]); console.log('✗ ' + name + '\n   ' + String(e && e.stack || e)); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }
async function until(fn, ms = 8000) { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } return v; }

// HP のファイルの指紋（あとで「1 つも変わっていない」を確かめる）
function fingerprint(dir) {
  const out = {};
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name === '.git' || e.name === 'node_modules') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex'); } };
  walk(dir);
  return out;
}
const before = fingerprint(HP_DIR);

const app = await startAll({ port: PORT, gasPort: GAS_PORT, stateDir: STATE, quiet: true });
let hp;
try { hp = await startHp({ dir: HP_DIR, port: HP_PORT, apiPort: PORT }); } catch (e) { app.stop(); throw e; }
const B = app.base, H = hp.base;
const admin = (p, method = 'GET', body) => fetch(B + '/api/admin/' + p, { method, headers: { 'content-type': 'application/json', 'X-Admin-Password': PW }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const mails = () => fetch(app.gas + '/mails.json').then((r) => r.json()).then((j) => j.mails);
const D1 = jstDate(5);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
const all = [], outside = [];
ctx.on('request', (r) => { all.push(r.url()); const u = new URL(r.url()); if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') outside.push(r.url()); });
await ctx.route((u) => !['127.0.0.1', 'localhost'].includes(u.hostname), (route) => route.abort());   // 外（地図・LINE・本番など）へは出さない（記録だけ）
const page = await ctx.newPage();
const dialogs = [];
page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

try {
  await step('下準備：テスト用の予約表に営業日を 1 日入れる（10:00〜18:00）', async () => {
    const r = await admin('hours', 'POST', { date: D1, s: '10:00', e: '18:00' });
    ok(r && !r.error, '営業日を入れられない：' + JSON.stringify(r));
  });

  await step('HP の置きかえ：予約欄の住所がテスト用・本番の住所が 1 つも残っていない・テスト用の印が出る', async () => {
    const html = await (await fetch(H + '/')).text();
    ok(!html.includes(PROD_HOST), 'HP に本番の住所が残っている');
    ok(html.includes("'/api/days'") && html.includes("'/api/book'"), '予約欄の /api/days・/api/book が HP と同じ住所になっていない');
    ok(html.includes('テスト用の HP です'), 'テスト用の印がない');
    for (const bad of ['/worker.js', '/wrangler.jsonc', '/.git/config', '/%2e%2e/%2e%2e/etc/passwd', '/README.md']) {
      const r = await fetch(H + bad); ok(r.status === 404, bad + ' が出てしまう（' + r.status + '）');
    }
  });

  let cancelUrl = '';
  await step('HP の予約欄：バストアップを押すと4つ（初回体験・通常1回・5回コース・10回コース）から1つ選ぶ。1つだけでも料金の目安が出る（2026/11/6）', async () => {
    await page.goto(H + '/#reserve');
    await page.waitForSelector('#ycMenus button', { timeout: 15000 });
    await page.locator('#ycMenus button[data-i]', { hasText: 'バストアップ' }).first().click();
    const subs = await page.$$eval('#ycMenus button.yc-sub', (bs) => bs.map((b) => b.textContent));
    ok(subs.length === 4 && /初回体験/.test(subs[0]) && /10回コース/.test(subs[3]), 'バストアップの4つが出ない：' + subs.join(' / '));
    await page.locator('#ycMenus button.yc-sub', { hasText: '初回体験' }).click();
    ok((await page.textContent('#ycDur')).includes('料金の目安　6,600円'), '1つだけで料金の目安が出ない：' + await page.textContent('#ycDur'));
    await page.locator('#ycMenus button.yc-sub', { hasText: '5回コース' }).click();
    const on = await page.$$eval('#ycMenus button.yc-sub[aria-pressed="true"]', (bs) => bs.map((b) => b.textContent));
    ok(on.length === 1 && /5回コース/.test(on[0]), '入れかわらない：' + on.join(' / '));
    ok((await page.textContent('#ycDur')).includes('39,600円'), '5回コースの料金が出ない：' + await page.textContent('#ycDur'));
  });
  await step('HP の予約欄で予約する（メニュー → 日付 → 10:00 → 入力 → 確認画面 → 予約する）→ 送ったつもりのメール 2 通', async () => {
    const n0 = (await mails()).length;
    await page.goto(H + '/#reserve');
    await page.waitForSelector('#ycMenus button', { timeout: 15000 });
    await page.locator('#ycMenus button', { hasText: 'よもぎ蒸し' }).first().click();
    await page.waitForSelector('#ycCalbox:not([hidden])');
    const want = D1.slice(0, 4) + '年' + (+D1.slice(5, 7)) + '月';
    for (let i = 0; i < 3 && (await page.textContent('#ycMt')) !== want; i++) await page.click('#ycNext');
    await page.click(`#ycG button[data-d="${D1}"]`);
    await page.click('#ycT button[data-t="600"]');
    await page.fill('#ycNm', 'テスト 花子');
    await page.fill('#ycTl', '090-1234-5678');
    await page.fill('#ycMl', 'hana@example.com');
    await page.check('#ycAg');
    await page.click('#ycGo');
    await page.waitForSelector('#ycFc:not([hidden])');
    ok((await page.textContent('#ycFc')).includes('hana@example.com'), '確認画面にメールが出ない');
    await page.click('#ycSend');
    await page.waitForFunction(() => { const d = document.getElementById('ycD'); return d && !d.hidden && /受け付けました/.test(d.textContent); }, null, { timeout: 15000 });
    const got = ((await until(async () => { const a = await mails(); return a.length >= n0 + 2 ? a : null; })) || []).slice(n0);
    ok(got.length === 2, 'メールが 2 通ではない：' + got.length);
    const cust = got.find((m) => m.to === 'hana@example.com'), mise = got.find((m) => m.to !== 'hana@example.com');
    ok(cust && cust.subject.includes('ご予約を承りました') && cust.body.includes('テスト 花子 様'), 'お客さんへの確認メールの中身がちがう');
    ok(mise && mise.subject.includes('【ネット予約】') && mise.body.includes('090-1234-5678'), 'お店への知らせの中身がちがう');
    const m = /(http:\/\/127\.0\.0\.1:(\d+)\/cancel\?t=[0-9a-f]+)/.exec(cust.body);
    ok(m && +m[2] === PORT, '確認メールの取り消しのリンクがテスト用の予約システム（:' + PORT + '）ではない：' + (m ? m[1] : 'なし'));
    cancelUrl = m[1];
    const a = await admin('all');
    ok(a.blocks.some((b) => b.date === D1 && b.kind === 'net' && b.name === 'テスト 花子' && b.s === '10:00'), 'テスト用の予約表に予約が入っていない');
  });

  await step('メールのリンクで取り消す → 取り消しのメール 2 通・テスト用の予約表から消える', async () => {
    ok(cancelUrl, '取り消しのリンクがない（前の手順がだめ）');
    const n0 = (await mails()).length;
    await page.goto(cancelUrl);
    await page.click('#cBtn');
    await page.click('#yes');
    await page.waitForFunction(() => /取り消しました|取り消しを承りました/.test(document.getElementById('box').textContent), null, { timeout: 8000 });
    const got = ((await until(async () => { const a = await mails(); return a.length >= n0 + 2 ? a : null; })) || []).slice(n0);
    ok(got.length === 2 && got.every((m) => m.kind === 'cancel'), '取り消しのメールが 2 通出ていない');
    const a = await admin('all');
    ok(!a.blocks.some((b) => b.date === D1 && b.kind === 'net'), 'テスト用の予約表から消えていない');
  });

  await step('HP の「予約ページで開く」「確認・取り消しはこちら」の行き先がテスト用の予約システム', async () => {
    await page.goto(H + '/#reserve');
    const hrefs = await page.$$eval('a', (as) => as.map((a) => a.href));
    ok(hrefs.includes(B + '/') && hrefs.includes(B + '/cancel'), '行き先がテスト用になっていない：' + hrefs.filter((h) => /8796|yoyaku/.test(h)).join(' , '));
    ok(!hrefs.some((h) => h.includes(PROD_HOST)), '本番の予約の住所へのリンクが残っている');
  });

  await step('HP から本番の予約システムへの通信が 1 つもない（外への通信は止めて記録だけ）', async () => {
    const prod = all.filter((u) => new URL(u).hostname === PROD_HOST);
    ok(!prod.length, '本番への通信：' + prod.slice(0, 3).join(' , '));
    ok(all.some((u) => u.startsWith(H + '/api/days')) && all.some((u) => u.startsWith(H + '/api/book')), 'HP から /api/days・/api/book を呼んでいない（テストの作りがおかしい）');
    ok(!outside.some((u) => /workers\.dev|script\.google/.test(u)), 'Cloudflare・GAS への通信：' + outside.filter((u) => /workers\.dev|script\.google/.test(u)).join(' , '));
    if (outside.length) console.log('   （止めた外への通信：' + [...new Set(outside.map((u) => new URL(u).hostname))].join('・') + '。本番の予約とは関係なし）');
  });

  await step('HP のファイルが 1 つも変わっていない（読むだけ）', async () => {
    const after = fingerprint(HP_DIR);
    const diff = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]);
    ok(!diff.length, '変わったファイル：' + diff.join(' , '));
  });

  await step('iPhone の小窓（ダイアログ）が 1 度も出ていない', async () => { ok(!dialogs.length, '小窓：' + dialogs.join(' / ')); });
} finally {
  await browser.close();
  hp.stop();
  app.stop();
  try { rmSync(STATE, { recursive: true, force: true }); } catch (e) { }
}

console.log('\n==== HP の予約欄の自動テストの結果（' + new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + '）====');
for (const r of results) console.log(r);
console.log(failed ? '\n✗ ' + failed + ' 件だめでした' : '\n✓ 全部通りました（' + results.length + ' 件）');
process.exit(failed ? 1 : 0);
