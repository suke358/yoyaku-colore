// 画面の動きのテスト（Node。2026/11/03 の【至急】の直し）。public の HTML から、直した所の JS だけを取り出して、偽物の api・confirm・alert で動かす（本物のサーバー・ブラウザは使わない）
//   3. 予約完了画面：メールを送れなかったとき「お送りしました」「届かないときは」を出さない（黄色の案内と「当日お待ちしております」だけ）
//   1. 休みにする：サーバーが needConfirm を返したら「n 件が消えます」と確かめ、OK のときだけ confirm:true で送り直す。やめたら送らない
//   4. ネット予約の取り消し：連絡先を出して「ご連絡ください」。手入力の取り消しは今までどおり短い表示だけ
//   5. 営業時間がはみ出る予約で止まったら、予約の時間を画面の中の確認で出す
// 11/03 夜の気づき直し：confirm・alert をやめて画面の中の確認（ask）に（8）・止まったら営業時間の選ぶ欄を実際の時刻に戻す（7）
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
// ask（画面の中の確認）の偽物：cancel があれば「確認」（answers の順に OK/やめる を押す）、なければ「お知らせ」。中身の文は title＋body
function load(replies, answers) {
  const calls = [], toasts = [], alerts = [], confirms = [], asks = [];
  const api = (path, method, body) => { calls.push({ path, method, body }); const r = replies.shift(); return r instanceof Error ? Promise.reject(r) : Promise.resolve(r || { ok: true }); };
  const ask = (o) => { asks.push(o); const t = (o.title || '') + '\n' + (o.body || ''); if (o.cancel) { confirms.push(t); if (answers.shift() && o.onOk) o.onOk(); } else alerts.push(t); };
  const f = new Function('api', 'toast', 'ask', 'reload', 'jp', fn('offDay') + fn('hoursErr') + fn('unblock') + '\nreturn { offDay, hoursErr, unblock };');
  const o = f(api, (t) => toasts.push(t), ask, () => Promise.resolve(), (k) => k);
  return { ...o, calls, toasts, alerts, confirms, asks };
}
const err = (status, data) => { const e = new Error(data.error); e.status = status; e.data = data; return e; };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('1. 休みにする前の確認（admin.html offDay）', () => {
  it('needConfirm が返ったら「2 件が消えます」と聞き、OK なら confirm:true で送り直す', async () => {
    const t = load([err(409, { error: 'x', needConfirm: true, count: 2 }), { ok: true }], [true]);
    t.offDay('2027-04-15'); await tick(); await tick();
    expect(t.confirms[0]).toContain('2 件が消えます');
    expect(t.asks[0]).toMatchObject({ ok: '休みにする', cancel: 'やめる', danger: true });
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
  it('outside があれば画面の中のお知らせで出す。ほかのエラーは短い表示', () => {
    const t = load([], []);
    t.hoursErr(err(409, { error: '営業時間の外になる予約が 1 件あります：16:00〜17:00（LINE・電話）', outside: [{}] }));
    expect(t.alerts[0]).toContain('16:00〜17:00');
    expect(t.alerts[0]).toContain('変えていません');
    t.hoursErr(err(409, { error: 'x', outside: [{}] }), { s: '10:00', e: '17:00' });
    expect(t.alerts[1]).toContain('10:00〜17:00 のままです');
    t.hoursErr(new Error('日にちと時間を確かめてください'));
    expect(t.toasts[0]).toContain('確かめて');
  });
});

// ---------- 8. 小窓（confirm・alert・prompt）をやめた ----------
describe('8. iPhone の小窓を使わない（画面の中の確認 ask）', () => {
  it('public のどの画面にも confirm(・alert(・prompt( が残っていない', () => {
    for (const f of ['admin.html', 'index.html', 'cancel.html', 'miru.html']) {
      const t = readFileSync(new URL('../public/' + f, import.meta.url), 'utf8');
      expect(t, f).not.toMatch(/\b(window\.)?(confirm|alert|prompt)\s*\(/);
    }
  });
  // 偽物の画面（#dlg とボタン）で ask・dlgClose を動かす
  function dom() {
    const els = {}, d = { style: {}, innerHTML: '' };
    els.dlg = d;
    const document = { getElementById: (id) => (id === 'dlg' ? d : (/id='dlgNo'/.test(d.innerHTML) && id === 'dlgNo') || (/id='dlgYes'/.test(d.innerHTML) && id === 'dlgYes') ? (els[id] = els[id] || { focus() { document.focused = id; } }) : null) };
    const f = new Function('document', 'esc', 'var dlgOk=null;' + fn('ask') + fn('dlgClose') + '\nreturn { ask, dlgClose };');
    return { ...f(document, (x) => String(x).replace(/</g, '&lt;')), d, document };
  }
  it('確認：2つのボタン、初めは「やめる」にフォーカス。「やめる」なら何もしない', () => {
    const t = dom(); let n = 0;
    t.ask({ title: '休みにしますか？', body: '1 件が消えます', ok: '休みにする', cancel: 'やめる', danger: true, onOk: () => n++ });
    expect(t.d.style.display).toBe('flex');
    expect(t.d.innerHTML).toContain('休みにする');
    expect(t.d.innerHTML).toContain('やめる');
    expect(t.d.innerHTML).toContain('danger');
    expect(t.document.focused).toBe('dlgNo');
    t.dlgClose(false);
    expect(n).toBe(0);
    expect(t.d.style.display).toBe('none');
  });
  it('確認：OK で1回だけ動く（2回押しても1回）', () => {
    const t = dom(); let n = 0;
    t.ask({ title: 'x', ok: 'する', cancel: 'やめる', onOk: () => n++ });
    t.dlgClose(true); t.dlgClose(true);
    expect(n).toBe(1);
  });
  it('お知らせ：ボタンは「わかりました」1つ。文は esc を通す', () => {
    const t = dom();
    t.ask({ title: '取り消しました', body: '<b>山田</b> 様' });
    expect(t.d.innerHTML).toContain('わかりました');
    expect(t.d.innerHTML).not.toContain('dlgNo');
    expect(t.d.innerHTML).toContain('&lt;b>山田');
    expect(t.document.focused).toBe('dlgYes');
  });
  it('画面に #dlg の置き場所がある', () => {
    expect(adminHtml).toMatch(/<div class="dlg" id="dlg"><\/div>/);
  });
});

// ---------- 7. 止まったら営業時間の選ぶ欄を実際の時刻に戻す ----------
describe('7. 営業時間を変えて止まったとき、選ぶ欄を戻す（admin.html chH・backH）', () => {
  function load7(reply) {
    const asks = [], toasts = [], sels = { hS: { value: '' }, hE: { value: '' } };
    let renders = 0, blurred = 0;
    const document = { activeElement: { blur() { blurred++; } }, getElementById: (id) => sels[id] || null };
    const api = () => (reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply));
    const hours = { '2027-04-15': { s: '10:00', e: '17:00' } };
    const f = new Function('api', 'toast', 'ask', 'reload', 'renderAdmin', 'document', 'hours', 'sel', 'm2',
      'var hOpen=false;' + fn('chH') + fn('backH') + fn('hoursErr') + '\nreturn { chH, open: function(){return hOpen} };');
    const m2 = (t) => { const a = t.split(':'); return +a[0] * 60 + +a[1]; };
    const o = f(api, (t) => toasts.push(t), (x) => asks.push(x), () => Promise.resolve(), () => { renders++; sels.hS.value = 'x'; sels.hE.value = 'x'; }, document, hours, '2027-04-15', m2);
    // 選ぶ欄は、押した値（15:00）になっている
    sels.hE.value = '15:00';
    return { ...o, asks, toasts, sels, r: () => renders, b: () => blurred };
  }
  it('はみ出る予約で 409：お知らせに「10:00〜17:00 のまま」、選ぶ欄は 10:00 / 17:00 に戻る・折りたたみは開いたまま', async () => {
    const t = load7(err(409, { error: '営業時間の外になる予約が 1 件あります：16:00〜17:00（LINE・電話）', outside: [{}] }));
    t.chH('e', '15:00'); await tick(); await tick();
    expect(t.asks[0].body).toContain('10:00〜17:00 のままです');
    expect(t.sels.hS.value).toBe('10:00');
    expect(t.sels.hE.value).toBe('17:00');
    expect(t.r()).toBe(1);
    expect(t.b()).toBe(1);
    expect(t.open()).toBe(true);
  });
  it('終わりが始まりより前：送らずに、選ぶ欄を戻す', () => {
    const t = load7({ ok: true });
    t.chH('e', '09:00');
    expect(t.toasts[0]).toContain('後にして');
    expect(t.sels.hE.value).toBe('17:00');
  });
  it('うまくいったときは reload（戻さない）', async () => {
    const t = load7({ ok: true });
    t.chH('e', '18:00'); await tick();
    expect(t.toasts[0]).toBe('営業時間を変えました');
    expect(t.r()).toBe(0);
  });
  it('描き直しで、開いていた折りたたみを開いたまま・選ぶ欄に id がある', () => {
    expect(adminHtml).toMatch(/<details class='fold'"\+\(hOpen\?" open":""\)\+"><summary>この日の営業時間を変える/);
    expect(adminHtml).toContain("<select id='hS'");
    expect(adminHtml).toContain("<select id='hE'");
  });
});

describe('古いスマホ向けの書き方（直した所に const・=>・async を入れない）', () => {
  it('admin.html・index.html の直した関数', () => {
    for (const s of [fn('offDay'), fn('hoursErr'), fn('unblock'), fn('askCancel'), fn('ask'), fn('dlgClose'), fn('chH'), fn('backH'), fn('tapDay'), index.slice(a0, a1)]) expect(s).not.toMatch(/=>|\bconst\b|\blet\b|async /);
  });
  it('確認画面の CSS に flex の gap・inset を使わない', () => {
    const css = adminHtml.match(/\.dlg\{[\s\S]*?\.dlgab button\.yes\.danger\{[^}]*\}/)[0];
    expect(css).not.toMatch(/\bgap:|\binset:/);
  });
});
