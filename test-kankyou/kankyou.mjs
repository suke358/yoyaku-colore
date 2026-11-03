// テスト用の予約システムを動かす共通の部品（2026/11/03）。start.mjs（本人が見る用）と e2e.mjs（自動テスト）が使う
// 1. 安全の確かめ（本番の D1・KV・GAS につながる設定なら止める）
// 2. 偽物のメール係と wrangler dev（手元だけ）を立ち上げる・止める
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.join(HERE, '..');
export const CONFIG = path.join(HERE, 'wrangler.test.jsonc');

function stripJsonc(t) { return t.replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]+\/\/[^"\n]*$/gm, ''); }

/** 本番の設定（wrangler.jsonc）の D1・KV の番号を読む（テスト用の設定に同じ番号が入っていないかを見るため） */
function prodIds() {
  const p = JSON.parse(stripJsonc(readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8')));
  return [...(p.d1_databases || []).map((d) => d.database_id), ...(p.kv_namespaces || []).map((k) => k.id)].filter(Boolean);
}

/**
 * 安全の確かめ。1 つでも当てはまれば理由を返す（空なら合格）
 * @param {{ gasUrl?: string }} [o] gasUrl＝--var で上書きする GAS_URL
 * @returns {string[]}
 */
export function safetyProblems(o = {}) {
  const out = [];
  const raw = readFileSync(CONFIG, 'utf8');
  const cfg = JSON.parse(stripJsonc(raw));
  for (const id of prodIds()) if (raw.includes(id)) out.push('テスト用の設定に本番の番号（' + id.slice(0, 8) + '…）が入っています');
  if (cfg.name === 'yoyaku-colore') out.push('テスト用の設定の name が本番と同じです');
  if (/"remote"\s*:\s*true/.test(raw)) out.push('テスト用の設定に remote: true があります（Cloudflare の本物につながる）');
  const gas = o.gasUrl || (cfg.vars && cfg.vars.GAS_URL) || '';
  if (!/^http:\/\/127\.0\.0\.1:\d+\/exec$/.test(gas)) out.push('GAS_URL が手元の偽物（http://127.0.0.1:…/exec）になっていません：' + gas);
  if (/script\.google/.test(raw)) out.push('テスト用の設定に本物の GAS の URL があります');
  for (const f of ['.dev.vars', '.env', '.dev.vars.test', '.env.test']) if (existsSync(path.join(HERE, f))) out.push('test-kankyou/' + f + ' があります（本物の値が入るおそれ。消してください）');
  return out;
}

/** wrangler の場所（手元の node_modules にあればそれ。なければ npx） */
function wranglerCmd() {
  const local = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
  return existsSync(local) ? { cmd: local, pre: [] } : { cmd: 'npx', pre: ['-y', 'wrangler@4'] };
}

/**
 * 偽物のメール係と wrangler dev を立ち上げる。両方が答えるまで待つ
 * @param {{ port: number, gasPort: number, stateDir: string, ip?: string, quiet?: boolean, testScheduled?: boolean }} o
 */
export async function startAll(o) {
  const major = +process.versions.node.split('.')[0];
  if (major < 22) throw new Error('Node.js が古いので動きません（今 v' + process.versions.node + '・v22 以上が要る。wrangler が v22 以上でないと動かない）。Mac の node を上げてから、もう一度');
  const gasUrl = 'http://127.0.0.1:' + o.gasPort + '/exec';
  const bad = safetyProblems({ gasUrl });
  if (bad.length) throw new Error('安全の確かめで止めました：\n- ' + bad.join('\n- '));
  const env = { ...process.env, FAKE_GAS_PORT: String(o.gasPort), TEST_STATE_DIR: o.stateDir, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };
  // 本物の Cloudflare の鍵を wrangler に渡さない（手元だけで動かすため。あっても使わせない）
  delete env.CLOUDFLARE_API_TOKEN; delete env.CLOUDFLARE_ACCOUNT_ID; delete env.CLOUDFLARE_API_KEY;
  const procs = [];
  const log = (name) => (b) => { if (!o.quiet) process.stdout.write('[' + name + '] ' + b); };
  const gas = spawn(process.execPath, [path.join(HERE, 'fake_gas.mjs')], { cwd: ROOT, env });
  gas.stdout.on('data', log('メール係')); gas.stderr.on('data', log('メール係'));
  procs.push(gas);
  const w = wranglerCmd();
  const args = [...w.pre, 'dev', '--local', '--config', CONFIG, '--port', String(o.port), '--ip', o.ip || '127.0.0.1',
    '--persist-to', path.join(o.stateDir, 'wrangler'), '--var', 'GAS_URL:' + gasUrl, '--inspector-port', String(o.port + 1000), '--show-interactive-dev-session=false'];
  if (o.testScheduled) args.push('--test-scheduled');
  const wr = spawn(w.cmd, args, { cwd: ROOT, env });
  let wout = '';
  wr.stdout.on('data', (b) => { wout += b; log('予約システム')(b); });
  wr.stderr.on('data', (b) => { wout += b; log('予約システム')(b); });
  procs.push(wr);
  const stop = () => { for (const p of procs) { try { p.kill('SIGTERM'); } catch (e) { } } };
  // 途中で落ちたら（node が古い・ポートが使われている など）、待たずにすぐ止める（2026/11/03 レビューの直し）
  let died = '';
  gas.on('exit', (c) => { if (!died) died = '偽物のメール係が止まりました（終わりの番号 ' + c + '）'; });
  wr.on('exit', (c) => { if (!died) died = 'wrangler が止まりました（終わりの番号 ' + c + '）'; });
  wr.on('error', (e) => { if (!died) died = 'wrangler を動かせません：' + e.message; });
  try {
    await waitFor('http://127.0.0.1:' + o.gasPort + '/mails.json', 20000, () => died);
    await waitFor('http://127.0.0.1:' + o.port + '/api/days', 120000, () => died);
  } catch (e) {
    stop();
    throw new Error(String(e) + '\n--- wrangler の出力 ---\n' + wout.slice(-3000));
  }
  return { stop, base: 'http://127.0.0.1:' + o.port, gas: 'http://127.0.0.1:' + o.gasPort, output: () => wout };
}

async function waitFor(url, ms, dead = () => '') {
  const end = Date.now() + ms;
  let last = '';
  while (Date.now() < end) {
    if (dead()) throw new Error(dead());
    try { const r = await fetch(url); if (r.status < 500 && /json/.test(r.headers.get('content-type') || '')) return; last = 'status ' + r.status + '（ほかのものがこのポートを使っているかもしれません）'; } catch (e) { last = String(e); }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(url + ' が答えません（' + last + '）');
}

/** 日本時間の今日から n 日後（YYYY-MM-DD） */
export function jstDate(n) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + n * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}
