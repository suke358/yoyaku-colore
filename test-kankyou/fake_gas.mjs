// 偽物のメール係（2026/11/03）。テスト用の予約システムだけが使う。本物の GAS（お店の Gmail）の代わり
// - gas/Code.gs をそのまま読みこんで doPost を動かす（文面は本物と同じ）。ただし MailApp は偽物で、メールは外に出さない
// - 「送ったつもりのメール」は http://127.0.0.1:8788/ で見られる（新しい順）。test-kankyou/.state/mails.jsonl にも残す
// - 「メールを送れなかった」の試し：画面のボタンか POST /fail?on=1 で、次から ok:false を返す（お店の画面の「メール未送」を見る用）
// 使い方：node test-kankyou/fake_gas.mjs（ふつうは start.mjs が一緒に動かす）。外のネットには一度もつながない
import http from 'node:http';
import { readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.FAKE_GAS_PORT || 8788);
const TOKEN = 'test-gas-token-1103';   // wrangler.test.jsonc の GAS_TOKEN と同じ（本物ではない）
const STATE = process.env.TEST_STATE_DIR || path.join(HERE, '.state');
mkdirSync(STATE, { recursive: true });
const LOG = path.join(STATE, 'mails.jsonl');

/** @type {{ n: number, at: string, to: string, replyTo: string, name: string, subject: string, body: string, kind: string }[]} */
const mails = [];
let failMode = false;
let current = '';   // 今動いている POST の種類（予約・取り消し・2 日前）

// gas/Code.gs を読みこむ（送る所 MailApp・合言葉 PropertiesService・返事 ContentService だけを偽物に）
const src = readFileSync(path.join(HERE, '..', 'gas', 'Code.gs'), 'utf8');
const MailApp = {
  sendEmail(o) {
    const m = { n: mails.length + 1, at: new Date().toISOString(), to: String(o.to || ''), replyTo: String(o.replyTo || ''), name: String(o.name || ''), subject: String(o.subject || ''), body: String(o.body || ''), kind: current };
    mails.push(m);
    appendFileSync(LOG, JSON.stringify(m) + '\n');
    console.log('[偽物のメール] 送ったつもり #' + m.n + '：' + m.subject + '（宛先 ' + m.to + '）');
  }
};
const PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAS_TOKEN' ? TOKEN : null) }) };
const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) };
const gas = new Function('MailApp', 'PropertiesService', 'ContentService', src + '\nreturn { doPost: doPost };')(MailApp, PropertiesService, ContentService);

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }
function linkify(s) { return esc(s).replace(/(https?:\/\/[^\s（）]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); }
const KIND = { book: '予約', cancel: '取り消し', reminder: '2 日前のお知らせ', '': '' };

function page() {
  const list = mails.slice().reverse().map((m) =>
    `<div class="m"><div class="h"><b>#${m.n}</b> <span class="k">${esc(KIND[m.kind] || m.kind)}</span> ${esc(new Date(m.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }))}</div>` +
    `<div class="s">${esc(m.subject)}</div><div class="t">宛先：${esc(m.to)}${m.replyTo ? '　返信先：' + esc(m.replyTo) : ''}　差出人の名前：${esc(m.name)}</div>` +
    `<pre>${linkify(m.body)}</pre></div>`).join('');
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>送ったつもりのメール（テスト用）</title><style>
body{font-family:-apple-system,"Hiragino Sans",sans-serif;margin:0;background:#f6f6f6;color:#222}
.top{background:#334155;color:#fff;padding:12px 16px}.top b{font-size:17px}.top small{display:block;opacity:.8}
.wrap{max-width:760px;margin:0 auto;padding:12px 16px}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
button{font-size:14px;padding:8px 12px;border-radius:8px;border:1px solid #334155;background:#fff;cursor:pointer}
.fail{color:#b00020;font-weight:bold}
.m{background:#fff;border-radius:10px;padding:12px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.h{font-size:13px;color:#555}.k{display:inline-block;background:#e98ca0;color:#fff;border-radius:6px;padding:0 6px;margin:0 4px}
.s{font-weight:bold;margin:6px 0 2px}.t{font-size:12px;color:#666;word-break:break-all}
pre{white-space:pre-wrap;word-break:break-all;font-family:inherit;font-size:14px;line-height:1.6;background:#fafafa;padding:8px;border-radius:6px}
.empty{color:#777;text-align:center;padding:24px}
</style></head><body><div class="top"><b>送ったつもりのメール（テスト用）</b><small>ここに出るメールは、どこにも送られていません。本物のお客さん・お店には届きません</small></div>
<div class="wrap"><div class="bar"><button onclick="location.reload()">更新</button>
<span>今の状態：${failMode ? '<span class="fail">「送れなかった」を返す</span>' : 'ふつう（送れた、と返す）'}</span>
<button onclick="fetch('/fail?on=${failMode ? 0 : 1}',{method:'POST'}).then(()=>location.reload())">${failMode ? 'ふつうに戻す' : '次から「送れなかった」にする'}</button>
<span style="font-size:13px;color:#666">全部で ${mails.length} 通</span></div>
${list || '<div class="empty">まだ 1 通もありません</div>'}</div></body></html>`;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page()); return; }
  if (req.method === 'GET' && url.pathname === '/mails.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ failMode, mails })); return; }
  if (req.method === 'POST' && url.pathname === '/fail') { failMode = url.searchParams.get('on') === '1'; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ failMode })); return; }
  if (req.method === 'POST' && url.pathname === '/reset') { mails.length = 0; failMode = false; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
  if (req.method === 'POST' && url.pathname === '/exec') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let out;
      if (failMode) out = { ok: false, error: 'test-fail' };   // 「送れなかった」の試し（メールは残さない）
      else {
        let d = {};
        try { d = JSON.parse(body); } catch (e) { }
        current = d.action === 'cancel' ? 'cancel' : d.action === 'reminder' ? 'reminder' : 'book';
        try { out = JSON.parse(gas.doPost({ postData: { contents: body } }).text); } catch (e) { out = { ok: false, error: String(e) }; }
        current = '';
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('ありません');
});
server.listen(PORT, '127.0.0.1', () => console.log('偽物のメール係：http://127.0.0.1:' + PORT + '/ （送ったつもりのメールを見る）'));
