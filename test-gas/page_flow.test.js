// 画面の動きのテスト（Node。2026/11/03 の【至急】の直し）。public の HTML から、直した所の JS だけを取り出して、偽物の api・confirm・alert で動かす（本物のサーバー・ブラウザは使わない）
//   3. 予約完了画面：メールを送れなかったとき「お送りしました」「届かないときは」を出さない（黄色の案内と「当日お待ちしております」だけ）
//   1. 休みにする：サーバーが needConfirm を返したら「n 件が消えます」と確かめ、OK のときだけ confirm:true で送り直す。やめたら送らない
//   4. ネット予約の取り消し：連絡先を出して「ご連絡ください」。手入力の取り消しは今までどおり短い表示だけ
//   5. 営業時間がはみ出る予約で止まったら、予約の時間を alert で出す
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const adminHtml = readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');

// ---------- 3. 予約完了画面 ----------
const a0 = index.indexOf('    var w2=[];'), a1 = index.indexOf('    document.getElementById("sheetBox").innerHTML=h+');
if (a0 < 0 || a1 < 0) throw new Error('index.html の完了画面の場所が見つからない');
const thanks = new Function('h', 'res', 'ml', 'SHOP', 'esc', index.slice(a0, a1) + '\nreturn h;');
const esc = (t) => String(t);
const SHOP = { lineUrl: 'https://line.example', tel: '0835-00-0000' };
const page = (body) => thanks('', { status: 200, body }, 'hana@example.com', SHOP, esc);

describe('3. 予約完了画面の「確認メールをお送りしました」', () => {
  it('送れたとき（mail:true）：「お送りしました」と「届かないときは」が出る', () => {
    const h = page({ ok: true, mail: true });
    expect(h).toContain('お送りしました');
    expect(h).toContain('hana@example.com');
    expect(h).toContain('届かないときは');
    expect(h).not.toContain('お送りできませんでした');
  });
  it('送れなかったとき（mail:false）：黄色の「お送りできませんでした」だけ。「お送りしました」「届かないときは」は出ない', () => {
    const h = page({ ok: true, mail: false, note: '確認メールをお送りできませんでした。ご予約は受け付けています。念のため LINE かお電話でご連絡ください' });
    expect(h).toContain('お送りできませんでした');
    expect(h).toContain('ご予約は受け付けています');
    expect(h).not.toContain('お送りしました');
    expect(h).not.toContain('迷惑メール');
    expect(h).not.toContain('hana@example.com');
    expect(h).toContain('お待ちしております');
  });
  it('mail が無い返事（前の版のサーバー）は、今までどおり「お送りしました」', () => {
    expect(page({ ok: true })).toContain('お送りしました');
  });
  it('デモは今までどおり見本だけ（「お送りしました」は出ない）', () => {
    const h = page({ ok: true, demo: true, mailPreview: '見本' });
    expect(h).toContain('これはデモです');
    expect(h).not.toContain('お送りしました');
  });
});

// ---------- admin.html の関数を取り出す ----------
// 1 行の関数（行末が }）を先に、なければ次の「行頭の }」まで
const fn = (name) => { const m = adminHtml.match(new RegExp('\\nfunction ' + name + '\\([^\\n]*}\\n|\\nfunction ' + name + '\\([\\s\\S]*?\\n}\\n')); if (!m) throw new Error(name + ' が admin.html にない'); return m[0]; };
// 呼ばれた api を記録する偽物。replies に順番に返事（Promise）を入れておく
function load(replies, answers) {
  const calls = [], toasts = [], alerts = [], confirms = [];
  const api = (path, method, body) => { calls.push({ path, method, body }); const r = replies.shift(); return r instanceof Error ? Promise.reject(r) : Promise.resolve(r || { ok: true }); };
  const f = new Function('api', 'toast', 'alert', 'confirm', 'reload', 'jp', fn('offDay') + fn('hoursErr') + fn('unblock') + '\nreturn { offDay, hoursErr, unblock };');
  const o = f(api, (t) => toasts.push(t), (t) => alerts.push(t), (t) => { confirms.push(t); return answers.shift(); }, () => Promise.resolve(), (k) => k);
  return { ...o, calls, toasts, alerts, confirms };
}
const err = (status, data) => { const e = new Error(data.error); e.status = status; e.data = data; return e; };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('1. 休みにする前の確認（admin.html offDay）', () => {
  it('needConfirm が返ったら「2 件が消えます」と聞き、OK なら confirm:true で送り直す', async () => {
    const t = load([err(409, { error: 'x', needConfirm: true, count: 2 }), { ok: true }], [true]);
    t.offDay('2027-04-15'); await tick(); await tick();
    expect(t.confirms[0]).toContain('2 件が消えます');
    expect(t.calls).toEqual([{ path: 'hours', method: 'DELETE', body: { date: '2027-04-15' } }, { path: 'hours', method: 'DELETE', body: { date: '2027-04-15', confirm: true } }]);
    expect(t.toasts[0]).toContain('休みにしました');
  });
  it('「キャンセル」を押したら送り直さない（予約は消えない）', async () => {
    const t = load([err(409, { error: 'x', needConfirm: true, count: 1 })], [false]);
    t.offDay('2027-04-15'); await tick(); await tick();
    expect(t.calls).toHaveLength(1);
    expect(t.toasts).toHaveLength(0);
  });
  it('予約がない日は確認なしで 1 回（今までどおり）', async () => {
    const t = load([{ ok: true }], []);
    t.offDay('2027-04-15'); await tick();
    expect(t.confirms).toHaveLength(0);
    expect(t.calls).toHaveLength(1);
  });
  it('ネット予約がある日の 409 は確認を出さず、そのまま知らせる', async () => {
    const t = load([err(409, { error: 'ネット予約がある日は休みにできません' })], []);
    t.offDay('2027-04-15'); await tick();
    expect(t.confirms).toHaveLength(0);
    expect(t.toasts[0]).toContain('ネット予約');
  });
});

describe('4. ネット予約の取り消しのあと（admin.html unblock）', () => {
  it('net:true なら、連絡先を出して「ご連絡ください」', async () => {
    const t = load([{ ok: true, net: true, contact: { name: 'テスト 花子', tel: '090-0000-0000', email: 'hana@example.com', when: '4月15日（木） 10:00〜', menu: 'よもぎ蒸し' } }], []);
    await t.unblock('x');
    expect(t.alerts[0]).toContain('ご連絡ください');
    expect(t.alerts[0]).toContain('テスト 花子');
    expect(t.alerts[0]).toContain('090-0000-0000');
    expect(t.alerts[0]).toContain('hana@example.com');
    expect(t.toasts).toHaveLength(0);
  });
  it('手入力・予約停止は今までどおり短い表示だけ（alert は出ない）', async () => {
    const t = load([{ ok: true }], []);
    await t.unblock('x', '予約停止をやめました');
    expect(t.alerts).toHaveLength(0);
    expect(t.toasts[0]).toBe('予約停止をやめました');
  });
  it('取り消しの確認の文に、ネット予約のときだけ「メールが届きません」と出す', () => {
    const s = fn('askCancel');
    expect(s).toMatch(/isNet\?[^:]*お客さまにはメールが届きません/);
  });
});

describe('5. 営業時間がはみ出る予約で止まったとき（admin.html hoursErr）', () => {
  it('outside があれば alert で出す。ほかのエラーは短い表示', () => {
    const t = load([], []);
    t.hoursErr(err(409, { error: '営業時間の外になる予約が 1 件あります：16:00〜17:00（LINE・電話）', outside: [{}] }));
    expect(t.alerts[0]).toContain('16:00〜17:00');
    t.hoursErr(new Error('日にちと時間を確かめてください'));
    expect(t.toasts[0]).toContain('確かめて');
  });
});

describe('古いスマホ向けの書き方（直した所に const・=>・async を入れない）', () => {
  it('admin.html・index.html の直した関数', () => {
    for (const s of [fn('offDay'), fn('hoursErr'), fn('unblock'), fn('askCancel'), index.slice(a0, a1)]) expect(s).not.toMatch(/=>|\bconst\b|\blet\b|async /);
  });
});
