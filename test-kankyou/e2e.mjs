// 画面を自動で押すテスト（Playwright。2026/11/03）。テスト用の予約システムを「まっさら」で立ち上げ、本物と同じ画面を順に押す
//   npm run e2e   （= node test-kankyou/e2e.mjs）
// たどる流れ：営業日を入れる → 営業時間を変える → お客さんが予約する（確認メール）→ メールのリンクで取り消す → 3 つの照合で取り消す
//           → お店が取り消す → LINE・電話の予約を入れて休みにする → ネット予約のある日は休みにできない → はみ出る営業時間で止まる
//           → メールを送れなかったとき → 2 日前のお知らせ → 本番・外への接続が 1 つもない
// 本人が見る用（start.mjs）とは別の場所・別のポート（8799・8798）で動かすので、本人のテスト用の予約表は変わらない
// Playwright は Mac には入っていない（Mac の node が古いため、Claude がクラウド側で回す）。入れるなら npm i --no-save playwright && npx playwright install chromium
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAll, safetyProblems, jstDate } from './kankyou.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.error('Playwright が入っていません。クラウド側で回すか、npm i --no-save playwright && npx playwright install chromium で入れてください');
  process.exit(2);
}

const PORT = 8799, GAS_PORT = 8798, PW = 'test-admin-1103';
const STATE = mkdtempSync(path.join(os.tmpdir(), 'yoyaku-e2e-'));
const results = [];
let failed = 0;
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push('✓ ' + name + '（' + ((Date.now() - t0) / 1000).toFixed(1) + '秒）'); console.log('✓ ' + name); }
  catch (e) { failed++; results.push('✗ ' + name + '：' + String(e && e.message || e).split('\n')[0]); console.log('✗ ' + name + '\n   ' + String(e && e.stack || e)); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

const app = await startAll({ port: PORT, gasPort: GAS_PORT, stateDir: STATE, quiet: true, testScheduled: true });
const B = app.base;
const admin = (p, method = 'GET', body) => fetch(B + '/api/admin/' + p, { method, headers: { 'content-type': 'application/json', 'X-Admin-Password': PW }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
const mails = () => fetch(app.gas + '/mails.json').then((r) => r.json()).then((j) => j.mails);
let ipN = 0;   // 下準備の予約は、毎回ちがう接続元にする（本番と同じ「同じ接続元から 10 分に 5 回まで」に引っかからないように）
const bookApi = (date, start, name, email, tel = '090-1111-2222') => fetch(B + '/api/book', { method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '10.0.0.' + (++ipN) }, body: JSON.stringify({ date, start, menus: ['よもぎ蒸し'], name, tel, email }) }).then((r) => r.json());
const dayOf = async (k) => { const a = await admin('all'); return { hours: a.hours.find((h) => h.date === k), blocks: a.blocks.filter((b) => b.date === k), cancels: (a.cancels || []).filter((c) => c.date === k) }; };
async function until(fn, ms = 8000) { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } return v; }

const D1 = jstDate(5), D2 = jstDate(6), D3 = jstDate(7), D4 = jstDate(8), D5 = jstDate(9), D2D = jstDate(2);
const md = (k) => { const [, m, d] = k.split('-'); return { m: +m, d: +d }; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
const outside = [];
ctx.on('request', (r) => { const u = new URL(r.url()); if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') outside.push(r.url()); });
await ctx.route((u) => !['127.0.0.1', 'localhost'].includes(u.hostname), (route) => route.abort());   // 画面から外へは出さない（記録だけ）
const dialogs = [];
const page = await ctx.newPage();
page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
const shop = await ctx.newPage();
shop.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

// お店の画面：カレンダーの日を押す（月をまたぐときは › で進める）
async function adminTap(k) {
  const { m, d } = md(k), want = k.slice(0, 4) + '年' + m + '月';
  await shop.waitForSelector('#month button.dc');   // カレンダーが出てから（出る前に › を押すと月がずれる）
  for (let i = 0; i < 3; i++) {
    const t = await shop.locator('#mTitle').textContent();
    if (t === want) break;
    await shop.locator('.month-h button').nth(1).click();
  }
  ok((await shop.locator('#mTitle').textContent()) === want, 'カレンダーが ' + want + ' にならない');
  await shop.locator(`xpath=//div[@id='month']/button[text()[1]='${d}']`).click();
}
async function toastHas(p, text) { await p.waitForFunction((t) => document.getElementById('toast').textContent.includes(t), text, { timeout: 8000 }); }

try {
  await step('安全の確かめ：テスト用の設定に本番の番号・本物の GAS がない', async () => {
    const bad = safetyProblems({ gasUrl: 'http://127.0.0.1:' + GAS_PORT + '/exec' });
    ok(!bad.length, bad.join(' / '));
    const out = app.output();
    ok(/DB[^\n]*local/i.test(out) && /BACKUP[^\n]*local/i.test(out), 'wrangler の出力で D1・KV が local になっていない');
    ok(!/\bremote\b/i.test(out.replace(/remote bindings disabled|--remote/gi, '')), 'wrangler の出力に remote がある');
  });

  await step('お店の画面に合言葉で入る', async () => {
    await shop.goto(B + '/admin');
    await shop.fill('#pw', PW);
    await shop.press('#pw', 'Enter');
    await shop.waitForSelector('#app', { state: 'visible' });
  });

  await step('営業日を入れる（「営業日を入れる」→「1日」→ 日を押す）× 5 日', async () => {
    await shop.click('#mPat');
    for (const k of [D1, D2, D3, D4, D5]) { await adminTap(k); await toastHas(shop, '10:00〜18:00'); }
    for (const k of [D1, D2, D3, D4, D5]) { const x = await dayOf(k); ok(x.hours && x.hours.s === '10:00' && x.hours.e === '18:00', k + ' の営業時間が入っていない'); }
  });

  await step('営業時間を変える（その日の「この日の営業時間を変える」で終わりを 17:00 に）', async () => {
    await shop.click('#mDay');
    await adminTap(D1);
    await shop.locator('summary', { hasText: 'この日の営業時間を変える' }).click();
    await shop.locator('details.fold').first().locator('select').nth(1).selectOption('17:00');
    await toastHas(shop, '営業時間を変えました');
    const x = await dayOf(D1); ok(x.hours.e === '17:00', '終わりが 17:00 になっていない：' + x.hours.e);
    await page.goto(B + '/');
    await page.locator(`.dbtn[aria-label^="${md(D1).m}月${md(D1).d}日 "]`).click();
    const chips = await page.locator('.chip').allTextContents();
    ok(chips.includes('16:00〜') && !chips.includes('16:30〜'), 'お客さんの画面の時間が 17:00 終わりになっていない：' + chips.join(','));
  });

  let cancelUrl = '';
  await step('お客さんが予約する（日 → 10:00 → 入力 → 確認画面 → 予約）→ 確認メールとお店への知らせ（送ったつもり）', async () => {
    const before = (await mails()).length;
    await page.goto(B + '/');
    await page.locator(`.dbtn[aria-label^="${md(D1).m}月${md(D1).d}日 "]`).click();
    await page.click('.chip[aria-label="10:00から予約する"]');
    await page.fill('#fName', 'テスト 花子');
    await page.fill('#fTel', '090-1234-5678');
    await page.fill('#fMail', 'hana@example.com');
    await page.check('#fAgree');
    await page.click('#fSend');
    await page.waitForSelector('#cfH');
    ok((await page.locator('#fConfirm').textContent()).includes('hana@example.com'), '確認画面にメールが出ない');
    await page.click('#cSend');
    await page.waitForSelector('.thanks');
    ok((await page.locator('.thanks').textContent()).includes('お送りしました'), '完了画面に「お送りしました」がない');
    const ms = (await until(async () => { const a = await mails(); return a.length >= before + 2 ? a : null; })) || [];
    const got = ms.slice(before);
    ok(got.length === 2, 'メールが 2 通ではない：' + got.length);
    const cust = got.find((m) => m.to === 'hana@example.com'), mise = got.find((m) => m.to !== 'hana@example.com');
    ok(cust && cust.subject.includes('ご予約を承りました') && cust.body.includes('テスト 花子 様'), 'お客さんへの確認メールの中身がちがう');
    ok(mise && mise.subject.includes('【ネット予約】') && mise.body.includes('090-1234-5678'), 'お店への知らせの中身がちがう');
    const m = /(http:\/\/127\.0\.0\.1:\d+\/cancel\?t=[0-9a-f]+)/.exec(cust.body);
    ok(m, '確認メールに取り消しのリンクがない'); cancelUrl = m[1];
    const x = await dayOf(D1); ok(x.blocks.some((b) => b.kind === 'net' && b.name === 'テスト 花子' && b.s === '10:00'), 'お店の台帳に予約が入っていない');
  });

  await step('お店の画面に予約が出る（名前・メール）', async () => {
    await shop.reload(); await shop.waitForSelector('#app', { state: 'visible' });
    await adminTap(D1);
    const t = await shop.locator('#dayBox').textContent();
    ok(t.includes('テスト 花子') && t.includes('hana@example.com') && t.includes('ネット'), 'お店の画面に予約が出ない：' + t.slice(0, 200));
  });

  await step('お客さんがメールのリンクで取り消す → 取り消しのメール 2 通（送ったつもり）・枠があく', async () => {
    const before = (await mails()).length;
    await page.goto(cancelUrl);
    await page.click('#cBtn');
    await page.click('#yes');
    await page.waitForFunction(() => /取り消しました|取り消しを承りました/.test(document.getElementById('box').textContent), null, { timeout: 8000 });
    const got = ((await until(async () => { const a = await mails(); return a.length >= before + 2 ? a : null; })) || []).slice(before);
    ok(got.length === 2 && got.every((m) => m.kind === 'cancel'), '取り消しのメールが 2 通出ていない');
    const x = await dayOf(D1); ok(!x.blocks.some((b) => b.kind === 'net') && x.cancels.length === 1, '台帳から消えていない／取り消しの記録がない');
  });

  await step('お客さんが /cancel で 3 つ（予約日・電話・メール）を入れて取り消す', async () => {
    const r = await bookApi(D2, '11:00', 'テスト 次郎', 'jiro@example.com', '090-2222-3333');
    ok(r.ok, '下準備の予約が入らない：' + JSON.stringify(r));
    await page.goto(B + '/cancel');
    await page.fill('#fDate', D2);
    await page.fill('#fTel', '09022223333');   // ハイフンなしでも同じ扱い
    await page.fill('#fMail', 'JIRO@example.com');   // 大文字でも同じ扱い
    await page.click('#fFind');
    await page.click('#cBtn');
    await page.click('#yes');
    await page.waitForFunction(() => /取り消しました|取り消しを承りました/.test(document.getElementById('box').textContent), null, { timeout: 8000 });
    const x = await dayOf(D2); ok(!x.blocks.some((b) => b.name === 'テスト 次郎'), '取り消されていない');
  });

  await step('お店が予約を取り消す（「予約を取り消す」→「本当に取り消す」）→ 連絡先の案内・メールは出ない', async () => {
    const r = await bookApi(D2, '13:00', 'テスト 三郎', 'saburo@example.com', '090-3333-4444');
    ok(r.ok, '下準備の予約が入らない');
    const before = (await mails()).length; dialogs.length = 0;
    await shop.reload(); await shop.waitForSelector('#app', { state: 'visible' });
    await adminTap(D2);
    await shop.locator('.ti.net button', { hasText: '予約を取り消す' }).click();
    await shop.locator('.askc button.yes').click();
    await until(async () => dialogs.length > 0);
    ok(dialogs.some((t) => t.includes('090-3333-4444')), '連絡先の案内（電話番号）が出ない');
    const x = await dayOf(D2); ok(!x.blocks.some((b) => b.kind === 'net') && x.cancels.some((c) => c.by_shop === 1), '取り消し・記録（お店で取り消し）がない');
    await new Promise((r) => setTimeout(r, 500));
    ok((await mails()).length === before, 'お店の取り消しでメールが出た');
  });

  await step('LINE・電話の予約を入れる（「LINE・電話で受けた予約を入れる」→ メニューを押す）', async () => {
    await adminTap(D3);
    await shop.locator('summary', { hasText: 'LINE・電話で受けた予約を入れる' }).click();
    await shop.fill('#bName', 'テスト 電話');
    await shop.locator('[data-bp="0"]').click();
    await toastHas(shop, '予約を入れました');
    const x = await dayOf(D3); ok(x.blocks.some((b) => b.kind === 'man' && b.name === 'テスト 電話'), 'LINE・電話の予約が入っていない');
  });

  await step('休みにする（「休み」→ 日を押す → 「1 件が消えます」に OK）→ お客さんの画面から消える', async () => {
    dialogs.length = 0;
    await shop.click('#mPat');
    await shop.locator('[data-pat="-1"]').click();
    await adminTap(D3);
    await toastHas(shop, 'を休みにしました');
    ok(dialogs.some((t) => t.includes('1 件が消えます')), '「1 件が消えます」の確かめが出ない');
    const x = await dayOf(D3); ok(!x.hours && !x.blocks.length, '休みになっていない');
    await page.goto(B + '/'); await page.waitForSelector('.dbtn');
    ok(!(await page.locator(`.dbtn[aria-label^="${md(D3).m}月${md(D3).d}日 "]`).count()), 'お客さんの画面にまだ出る');
  });

  await step('ネット予約がある日は休みにできない（止まる・営業時間は残る）', async () => {
    ok((await bookApi(D4, '10:00', 'テスト 四郎', 'shiro@example.com', '090-4444-5555')).ok, '下準備の予約が入らない');
    await shop.reload(); await shop.waitForSelector('#app', { state: 'visible' });
    await shop.click('#mPat');
    await shop.locator('[data-pat="-1"]').click();
    await adminTap(D4);
    await shop.waitForFunction(() => document.getElementById('toast').classList.contains('on'), null, { timeout: 8000 });
    const x = await dayOf(D4); ok(x.hours && x.blocks.length === 1, '休みになってしまった');
  });

  await step('営業時間を変えると予約がはみ出るときは止まる（予約の時間を出す・変えない）', async () => {
    dialogs.length = 0;
    await shop.click('#mDay');
    await adminTap(D4);
    await shop.locator('summary', { hasText: 'この日の営業時間を変える' }).click();
    await shop.locator('details.fold').first().locator('select').first().selectOption('11:00');
    await until(async () => dialogs.length > 0);
    ok(dialogs.some((t) => t.includes('10:00')), 'はみ出る予約の時間が出ない：' + dialogs.join(' / '));
    const x = await dayOf(D4); ok(x.hours.s === '10:00', '営業時間が変わってしまった');
  });

  await step('メールを送れなかったとき：完了画面は「お送りできませんでした」・お店の画面に「メール未送」', async () => {
    await fetch(app.gas + '/fail?on=1', { method: 'POST' });
    await page.goto(B + '/');
    await page.locator(`.dbtn[aria-label^="${md(D5).m}月${md(D5).d}日 "]`).click();
    await page.click('.chip[aria-label="14:00から予約する"]');
    await page.fill('#fName', 'テスト 五郎'); await page.fill('#fTel', '090-5555-6666'); await page.fill('#fMail', 'goro@example.com');
    await page.check('#fAgree'); await page.click('#fSend'); await page.click('#cSend');
    await page.waitForSelector('.thanks');
    const t = await page.locator('.thanks').textContent();
    ok(t.includes('お送りできませんでした') && !t.includes('お送りしました'), '完了画面の案内がちがう');
    await fetch(app.gas + '/fail?on=0', { method: 'POST' });
    await shop.reload(); await shop.waitForSelector('#app', { state: 'visible' });
    await adminTap(D5);
    ok((await shop.locator('#dayBox').textContent()).includes('メール未送'), 'お店の画面に「メール未送」が出ない');
  });

  await step('2 日前のお知らせ（Cron を手で動かす）→ 2 日後の予約の人に 1 通（送ったつもり）', async () => {
    ok((await admin('hours', 'POST', { date: D2D, s: '10:00', e: '18:00' })).ok, '下準備の営業日が入らない');
    ok((await bookApi(D2D, '15:00', 'テスト 六子', 'mutsuko@example.com', '090-6666-7777')).ok, '下準備の予約が入らない');
    const before = (await mails()).length;
    await fetch(B + '/__scheduled?cron=0+1+*+*+*');
    const got = ((await until(async () => { const a = await mails(); return a.length > before ? a : null; })) || []).slice(before);
    ok(got.length === 1 && got[0].kind === 'reminder' && got[0].to === 'mutsuko@example.com', '2 日前のお知らせが出ていない：' + got.length);
  });

  await step('外への接続が 1 つもない（画面から本番・GAS・Cloudflare へ行っていない）', async () => {
    ok(!outside.length, '外への接続：' + outside.slice(0, 5).join(' , '));
    const all = await mails();
    ok(all.length >= 7, '偽物のメール係が受けた数が少ない');
  });
} finally {
  await browser.close();
  app.stop();
  try { rmSync(STATE, { recursive: true, force: true }); } catch (e) { }
}

console.log('\n==== 画面の自動テストの結果（' + new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) + '）====');
for (const r of results) console.log(r);
console.log(failed ? '\n✗ ' + failed + ' 件だめでした' : '\n✓ 全部通りました（' + results.length + ' 件）');
process.exit(failed ? 1 : 0);
