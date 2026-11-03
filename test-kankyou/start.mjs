// テスト用の予約システムを手元で動かす（本人がブラウザで見る用。2026/11/03）
//   node test-kankyou/start.mjs            … 前回の続きの予約表で動かす（はじめてのときは、明日から 14 日の営業日 10:00〜18:00 を入れておく）
//   node test-kankyou/start.mjs --reset    … テスト用の予約表をまっさらにしてから動かす
//   node test-kankyou/start.mjs --iphone   … 同じ Wi-Fi の iPhone からも開けるようにする（Mac の IP を出す）
//   colore の HP も一緒に出す（http://〜:8791/。HP の中の予約欄が、このテスト用の予約システムにつながる。2026/11/03）
//     HP の場所は既定で ~/src/colore-website。ちがう所なら --hp ほかの場所、出さないなら --no-hp
//     HP のファイルは読むだけ（書きかえない）。本番の予約の住所が置きかえられずに残っていたら、起動を止める
// 止めるときは、ターミナルで control + C
// 本番の予約表（D1）・バックアップ（KV）・メールの係（GAS）には一度もつながない（kankyou.mjs の安全の確かめで止める）
import { rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startAll, HERE, jstDate } from './kankyou.mjs';
import { startHp, DEFAULT_HP_DIR, checkHpDir } from './hp.mjs';

const PORT = 8790, GAS_PORT = 8788, HP_PORT = 8791;
const STATE = path.join(HERE, '.state');
const argv = process.argv.slice(2);
const iphone = argv.includes('--iphone');
if (argv.includes('--reset') && existsSync(STATE)) { rmSync(STATE, { recursive: true, force: true }); console.log('テスト用の予約表をまっさらにしました'); }

const noHp = argv.includes('--no-hp');
const hpAt = argv.indexOf('--hp');
const hpDir = hpAt >= 0 && argv[hpAt + 1] ? path.resolve(argv[hpAt + 1]) : DEFAULT_HP_DIR;
// HP の置きかえ残しは、予約システムを立ち上げる前に確かめる（残っていたら何も立ち上げずに止める）
if (!noHp && existsSync(hpDir)) {
  const bad = checkHpDir(hpDir);
  if (bad.length) { console.error('HP の中に、本番の予約の住所が置きかえられずに残っています。本番に飛ぶおそれがあるので止めました：\n- ' + bad.join('\n- ')); process.exit(1); }
}

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

let hp = null;
if (!noHp) {
  if (!existsSync(hpDir)) console.log('HP の場所が見つからないので、HP は出しません：' + hpDir + '（--hp ほかの場所 で指定できます）');
  else {
    try { hp = await startHp({ dir: hpDir, port: HP_PORT, apiPort: PORT, ip: iphone ? '0.0.0.0' : '127.0.0.1' }); }
    catch (e) { console.error(String(e && e.message || e)); app.stop(); process.exit(1); }
  }
}

let lan = '';
if (iphone) for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === 'IPv4' && !n.internal && !lan) lan = n.address;
const ipHost = iphone && lan ? 'http://' + lan : 'http://127.0.0.1';
const host = ipHost + ':' + PORT;
console.log(`
==== テスト用の予約システム（本番とは別。メールは外に出ません）====
お客さんの予約ページ  ${host}/
お店の画面           ${host}/admin    （合言葉 ${PW}）
見る専用の画面        ${host}/miru     （合言葉 test-miru-1103）
取り消しのページ      ${host}/cancel
送ったつもりのメール   ${app.gas}/      （Mac のブラウザで開く）
${hp ? 'colore の HP（テスト用） ' + ipHost + ':' + HP_PORT + '/    （予約欄がこのテスト用につながる）' : 'colore の HP は出していません'}
2 日前のお知らせを今すぐ動かす：${app.base}/__scheduled?cron=0+1+*+*+*
止めるとき：control + C
`);
const bye = () => { if (hp) hp.stop(); app.stop(); process.exit(0); };
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
