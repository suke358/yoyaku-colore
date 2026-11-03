// テスト用の予約システムを手元で動かす（本人がブラウザで見る用。2026/11/03）
//   node test-kankyou/start.mjs            … 前回の続きの予約表で動かす（はじめてのときは、明日から 14 日の営業日 10:00〜18:00 を入れておく）
//   node test-kankyou/start.mjs --reset    … テスト用の予約表をまっさらにしてから動かす
//   node test-kankyou/start.mjs --iphone   … 同じ Wi-Fi の iPhone からも開けるようにする（Mac の IP を出す）
// 止めるときは、ターミナルで control + C
// 本番の予約表（D1）・バックアップ（KV）・メールの係（GAS）には一度もつながない（kankyou.mjs の安全の確かめで止める）
import { rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAll, HERE, jstDate } from './kankyou.mjs';

const PORT = 8790, GAS_PORT = 8788;
const STATE = path.join(HERE, '.state');
const argv = process.argv.slice(2);
const iphone = argv.includes('--iphone');
if (argv.includes('--reset') && existsSync(STATE)) { rmSync(STATE, { recursive: true, force: true }); console.log('テスト用の予約表をまっさらにしました'); }

const PW = 'test-admin-1103';   // wrangler.test.jsonc の ADMIN_PASSWORD（テスト用）
let app;
try {
  app = await startAll({ port: PORT, gasPort: GAS_PORT, stateDir: STATE, ip: iphone ? '0.0.0.0' : '127.0.0.1', quiet: true, testScheduled: true });
} catch (e) {
  console.error(String(e && e.message || e));
  process.exit(1);
}

// はじめて（営業日が 1 つもない）なら、明日から 14 日の営業日を入れておく（すぐ予約を試せるように）
const all = await (await fetch(app.base + '/api/admin/all', { headers: { 'X-Admin-Password': PW } })).json();
if (!all.hours || !all.hours.length) {
  for (let i = 1; i <= 14; i++) await fetch(app.base + '/api/admin/hours', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Admin-Password': PW }, body: JSON.stringify({ date: jstDate(i), s: '10:00', e: '18:00' }) });
  console.log('はじめてなので、明日から 14 日の営業日（10:00〜18:00）を入れました');
}

let lan = '';
if (iphone) for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal && !lan) lan = n.address;
const host = iphone && lan ? 'http://' + lan + ':' + PORT : app.base;
console.log(`
==== テスト用の予約システム（本番とは別。メールは外に出ません）====
お客さんの予約ページ  ${host}/
お店の画面           ${host}/admin    （合言葉 ${PW}）
見る専用の画面        ${host}/miru     （合言葉 test-miru-1103）
取り消しのページ      ${host}/cancel
送ったつもりのメール   ${app.gas}/      （Mac のブラウザで開く）
2 日前のお知らせを今すぐ動かす：${app.base}/__scheduled?cron=0+1+*+*+*
止めるとき：control + C
`);
const bye = () => { app.stop(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
