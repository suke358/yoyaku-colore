// colore の HP をテスト用の予約システムにつないで手元で出す部品（2026/11/03）。start.mjs（本人が見る用）と e2e_hp.mjs（自動テスト）が使う
// - HP のファイル（既定は ~/src/colore-website）は「読むだけ」。書きかえない
// - 配るときだけ、HP の中の本番の予約の住所（https://yoyaku-colore.liftoff-358.workers.dev）を置きかえる
//     …/api/〇〇  → /api/〇〇（HP と同じ住所。この部品がテスト用の予約システムへ取り次ぐ。CORS の許可（shop.jsonc）を変えずに済む）
//     それ以外（予約ページ・/cancel）→ テスト用の予約システムの住所（http://〈開いた人の見ている住所〉:8790）
// - 置きかえ残し（https の予約の住所）が 1 つでもあれば、起動を止める（本番に飛ぶのを防ぐ）
import http from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROD_ORIGIN = 'https://yoyaku-colore.liftoff-358.workers.dev';
export const DEFAULT_HP_DIR = path.join(os.homedir(), 'src', 'colore-website');
const TEXT = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8' };
const BIN = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
// 出さないファイル（サイトの部品ではない・Cloudflare の設定）
const HIDE = new Set(['worker.js', 'wrangler.jsonc', 'wrangler.toml', 'readme.md', 'package.json', 'package-lock.json']);
const BANNER = '<div style="background:#b3261e;color:#fff;font:600 13px/1.5 sans-serif;text-align:center;padding:6px 8px">テスト用の HP です（予約は本番に入りません・メールは外に出ません）</div>';

/**
 * 本番の予約の住所を置きかえる
 * @param {string} text HP のファイルの中身
 * @param {string} yoyakuOrigin テスト用の予約システムの住所（例 http://127.0.0.1:8790）
 */
export function rewriteHp(text, yoyakuOrigin) {
  return text.split(PROD_ORIGIN + '/api/').join('/api/').split(PROD_ORIGIN).join(yoyakuOrigin);
}

/** 置きかえ残し（https で「yoyaku」を含む住所・本番の住所のホスト名）を返す。空なら合格 */
export function leftovers(text) {
  const out = new Set();
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>()]*yoyaku[^\s"'<>()]*/gi)) if (/^https:/i.test(m[0])) out.add(m[0]);
  for (const m of text.matchAll(/yoyaku-colore\.liftoff-358\.workers\.dev[^\s"'<>()]*/gi)) out.add(m[0]);
  return [...out];
}

/** HP の配るファイル（文字のもの）を全部置きかえてみて、残りを返す。HP の場所がおかしいときも理由を返す */
export function checkHpDir(dir, yoyakuOrigin = 'http://127.0.0.1:8790') {
  if (!existsSync(path.join(dir, 'index.html'))) return [dir + ' に index.html がありません（HP の場所を --hp で指定してください）'];
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (TEXT[path.extname(e.name).toLowerCase()] && !HIDE.has(e.name.toLowerCase())) {
        for (const l of leftovers(rewriteHp(readFileSync(p, 'utf8'), yoyakuOrigin))) out.push(path.relative(dir, p) + '：' + l);
      }
    }
  };
  walk(dir);
  return out;
}

/** ブラウザが見ている住所のホスト名（Host の頭）。おかしな値なら 127.0.0.1 */
function hostOf(req) {
  const h = String(req.headers.host || '').replace(/:\d+$/, '');
  return /^[A-Za-z0-9.-]{1,253}$/.test(h) ? h : '127.0.0.1';
}

/** URL の道から、HP の中のファイルの場所を出す（外・隠しファイル・出さないファイルは null） */
export function fileFor(dir, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch (e) { return null; }
  if (p.includes('\0')) return null;
  const parts = p.split('/').filter(Boolean);
  if (parts.some((s) => s === '..' || s.startsWith('.') || s === 'node_modules')) return null;
  if (parts.length && HIDE.has(parts[parts.length - 1].toLowerCase())) return null;
  let f = path.join(dir, ...parts);
  if (!f.startsWith(path.resolve(dir))) return null;
  if (existsSync(f) && statSync(f).isDirectory()) f = path.join(f, 'index.html');
  return existsSync(f) && statSync(f).isFile() ? f : null;
}

/**
 * HP を出す。/api/ はテスト用の予約システム（127.0.0.1:apiPort）へ取り次ぐ
 * @param {{ dir: string, port: number, apiPort: number, ip?: string }} o
 * @returns {Promise<{ stop: () => void, base: string }>}
 */
export async function startHp(o) {
  const dir = path.resolve(o.dir);
  const bad = checkHpDir(dir);
  if (bad.length) throw new Error('HP の中に、本番の予約の住所が置きかえられずに残っています（本番に飛ぶおそれがあるので止めました）：\n- ' + bad.join('\n- '));
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url || '/', 'http://x');
    const host = hostOf(req);
    if (u.pathname.startsWith('/api/')) {
      // テスト用の予約システムへ取り次ぐ。Host は「開いた人が見ている住所:8790」にして渡す（確認メールの取り消しのリンクが、iPhone からも開ける住所になるように）
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (!['host', 'connection', 'content-length', 'origin', 'referer'].includes(k)) headers[k] = /** @type {string} */ (v);
      headers.host = host + ':' + o.apiPort;
      const pr = http.request({ host: '127.0.0.1', port: o.apiPort, path: u.pathname + u.search, method: req.method, headers }, (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      });
      pr.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"error":"テスト用の予約システムにつながりません"}'); });
      pr.end(Buffer.concat(chunks));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let f = fileFor(dir, u.pathname), status = 200;
    if (!f) { f = existsSync(path.join(dir, '404.html')) ? path.join(dir, '404.html') : null; status = 404; }
    if (!f) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('ありません'); return; }
    const ext = path.extname(f).toLowerCase();
    const head = { 'cache-control': 'no-store' };
    if (TEXT[ext]) {
      let t = rewriteHp(readFileSync(f, 'utf8'), 'http://' + host + ':' + o.apiPort);
      if (ext === '.html') t = t.replace(/<body([^>]*)>/i, (m) => m + BANNER);
      res.writeHead(status, { ...head, 'content-type': TEXT[ext] });
      res.end(req.method === 'HEAD' ? undefined : t);
    } else {
      res.writeHead(status, { ...head, 'content-type': BIN[ext] || 'application/octet-stream' });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(f));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(o.port, o.ip || '127.0.0.1', () => resolve(undefined)); });
  return { stop: () => server.close(), base: 'http://127.0.0.1:' + o.port };
}
