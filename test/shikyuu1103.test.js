// 【至急】の直し（2026/11/03）のテスト。お店の画面の命令（/api/admin/…）で、次の 3 つを守る。GAS は偽物の fetch が受け止める（本物には送らない）
//   1. 休みにする前に：LINE・電話の予約がある日は「n 件消えます」と返して止める（confirm:true のときだけ消す）。ない日は今までどおり 1 回で休みになる
//   4. お店でネット予約を取り消したら：取り消しの記録（cancels）に by_shop=1 で残し、返事に連絡先を付ける（画面で「お客さまに連絡を」）
//   5. 営業時間を短くする前に：はみ出る予約があれば 409 で知らせて、営業時間を変えない
// （3. 予約完了画面の「送りました」は画面の話なので test-gas/page_flow.test.js で確かめる）
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import shopText from '../public/shop.jsonc?raw';

const SHOP = JSON.parse(shopText.replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]+\/\/[^"\n]*$/gm, ''));
const BUF = +SHOP.bufferMin || 0;
const ADMIN = 'test-admin-password';
const NOW_UTC = '2027-03-10T01:00:00Z';   // 日本時間 2027-03-10（水）10:00
const DAY = '2027-04-15';
const M1 = SHOP.menus[0];

const api = (path, init) => SELF.fetch('https://x' + path, init);
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const admin = (method, path, body) => api('/api/admin/' + path, { method, headers: { 'content-type': 'application/json', 'X-Admin-Password': ADMIN }, body: body ? JSON.stringify(body) : undefined });
const setHours = async (s, e) => { expect((await admin('POST', 'hours', { date: DAY, s, e })).status).toBe(200); };
const hoursOf = async () => env.DB.prepare('SELECT s, e FROM hours WHERE date = ?1').bind(DAY).first();
const blocks = async () => (await env.DB.prepare('SELECT id, kind, s, e FROM blocks WHERE date = ?1 ORDER BY s').bind(DAY).all()).results;
const cancelsAll = async () => (await env.DB.prepare('SELECT * FROM cancels ORDER BY date, s').all()).results;
const man = async (s, e, name) => { const r = await admin('POST', 'block', { date: DAY, s, e, menu: 'よもぎ蒸し', name: name || '' }); expect(r.status).toBe(200); return (await r.json()).id; };
const stop = async (s, e) => { const r = await admin('POST', 'block', { date: DAY, s, e, kind: 'stop' }); expect(r.status).toBe(200); return (await r.json()).id; };
const book = async (start) => {
  const r = await post('/api/book', { date: DAY, start, menu: M1.name, name: 'テスト 花子', tel: '090-0000-0000', email: 'hana@example.com' });
  expect(r.status).toBe(200);
  const j = await r.json();
  const row = await env.DB.prepare('SELECT cancel_token FROM blocks WHERE id = ?1').bind(j.id).first();
  return { id: j.id, token: row.cancel_token };
};

const gasCalls = [];
beforeAll(() => {
  vi.stubGlobal('fetch', async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === env.GAS_URL) {
      const d = JSON.parse(String(init && init.body || '{}'));
      gasCalls.push(d);
      if (d.action === 'cancel') return new Response(JSON.stringify({ ok: true, action: 'cancel' }), { headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error('テストからは外へ送らない: ' + url);
  });
});
beforeEach(async () => {
  gasCalls.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_UTC));
  await api('/api/days');   // 表を作る
  await env.DB.batch(['blocks', 'hours', 'cancels', 'auth_fail', 'book_rate'].map((t) => env.DB.prepare('DELETE FROM ' + t)));
  await setHours('10:00', '18:00');
});

describe('1. 休みにする前に「予約が n 件消えます」', () => {
  it('LINE・電話の予約が 2 件ある日：confirm なしは 409 needConfirm・count 2。何も消えない', async () => {
    await man('10:00', '11:00', '山田'); await man('13:00', '14:00');
    const r = await admin('DELETE', 'hours', { date: DAY });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j).toMatchObject({ needConfirm: true, count: 2 });
    expect(j.error).toContain('2 件');
    expect(await blocks()).toHaveLength(2);
    expect(await hoursOf()).toMatchObject({ s: '10:00', e: '18:00' });
  });

  it('confirm:true で送り直すと休みになり、その日の予約も消える', async () => {
    await man('10:00', '11:00');
    expect((await admin('DELETE', 'hours', { date: DAY, confirm: true })).status).toBe(200);
    expect(await blocks()).toHaveLength(0);
    expect(await hoursOf()).toBeNull();
  });

  it('予約がない日・予約停止だけの日は、今までどおり 1 回で休みになる（確認は出ない）', async () => {
    expect((await admin('DELETE', 'hours', { date: DAY })).status).toBe(200);
    await setHours('10:00', '18:00');
    await stop('12:00', '13:00');
    expect((await admin('DELETE', 'hours', { date: DAY })).status).toBe(200);
    expect(await blocks()).toHaveLength(0);
  });

  it('ネット予約がある日は、confirm:true でも今までどおり休みにできない（409）', async () => {
    await book('10:00'); await man('14:00', '15:00');
    const r = await admin('DELETE', 'hours', { date: DAY, confirm: true });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain('ネット予約');
    expect(await blocks()).toHaveLength(2);
  });

  it('confirm が真偽でないときは 400（消さない）', async () => {
    await man('10:00', '11:00');
    expect((await admin('DELETE', 'hours', { date: DAY, confirm: 'true' })).status).toBe(400);
    expect(await blocks()).toHaveLength(1);
  });
});

describe('4. お店でネット予約を取り消したら、記録に残して「お客さまに連絡を」', () => {
  it('返事に net:true と連絡先。台帳からは消え（枠があく）、cancels に by_shop=1・mailng=1 で残る。メールは送らない', async () => {
    const a = await book('10:00');
    gasCalls.length = 0;
    const r = await admin('DELETE', 'block', { id: a.id });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.net).toBe(true);
    expect(j.contact).toMatchObject({ name: 'テスト 花子', tel: '090-0000-0000', email: 'hana@example.com', menu: M1.name });
    expect(j.contact.when).toContain('10:00');
    expect(await blocks()).toHaveLength(0);
    const cx = await cancelsAll();
    expect(cx).toHaveLength(1);
    expect(cx[0]).toMatchObject({ id: a.id, by_shop: 1, mailng: 1, name: 'テスト 花子', token: a.token });
    expect(gasCalls).toHaveLength(0);
  });

  it('お店の画面の一覧（/api/admin/all）の cancels に by_shop が出る', async () => {
    const a = await book('10:00');
    await admin('DELETE', 'block', { id: a.id });
    const all = await (await admin('GET', 'all')).json();
    expect(all.cancels).toHaveLength(1);
    expect(all.cancels[0].by_shop).toBe(1);
    expect(all.cancels[0].token).toBeUndefined();   // 取り消しのリンクの文字列は出さない
  });

  it('お客さんが後からメールのリンクを押すと「取り消し済み」と出る（見つかりません ではない）', async () => {
    const a = await book('10:00');
    await admin('DELETE', 'block', { id: a.id });
    const r = await post('/api/cancel', { t: a.token });
    expect(r.status).toBe(200);
    expect((await r.json()).already).toBe(true);
  });

  it('お客さんが自分で取り消したものは by_shop=0（今までどおり「お客さまが取り消し」）', async () => {
    const a = await book('10:00');
    expect((await (await post('/api/cancel', { t: a.token, confirm: true })).json()).canceled).toBe(true);
    expect((await cancelsAll())[0].by_shop).toBe(0);
  });

  it('過ぎた日のネット予約は、消すだけ（記録・連絡先なし。名前なども空になっているため）', async () => {
    const a = await book('10:00');
    vi.setSystemTime(new Date('2027-04-17T01:00:00Z'));   // 来店日の 2 日後
    const r = await admin('DELETE', 'block', { id: a.id });
    expect(r.status).toBe(200);
    expect((await r.json()).net).toBeUndefined();
    expect(await blocks()).toHaveLength(0);
    expect(await cancelsAll()).toHaveLength(0);
  });

  it('LINE・電話の予約と予約停止は、今までどおり消すだけ（記録・連絡先なし）', async () => {
    const id1 = await man('10:00', '11:00', '山田'); const id2 = await stop('12:00', '13:00');
    for (const id of [id1, id2]) {
      const r = await admin('DELETE', 'block', { id });
      expect(r.status).toBe(200);
      expect((await r.json()).net).toBeUndefined();
    }
    expect(await blocks()).toHaveLength(0);
    expect(await cancelsAll()).toHaveLength(0);
  });

  it('同じ予約を 2 回取り消しても壊れない（2 回目は ok だけ）。取り消した枠にまた予約が入る', async () => {
    const a = await book('10:00');
    expect((await (await admin('DELETE', 'block', { id: a.id })).json()).net).toBe(true);
    const r2 = await admin('DELETE', 'block', { id: a.id });
    expect(r2.status).toBe(200);
    expect((await r2.json()).net).toBeUndefined();
    expect(await cancelsAll()).toHaveLength(1);
    expect((await post('/api/book', { date: DAY, start: '10:00', menu: M1.name, name: '次の 人', tel: '090-3333-3333', email: 'next@example.com' })).status).toBe(200);
  });

  it('見る専用の合言葉では取り消せない（403・何も変わらない）', async () => {
    const a = await book('10:00');
    const r = await api('/api/admin/block', { method: 'DELETE', headers: { 'content-type': 'application/json', 'X-Admin-Password': 'test-view-password' }, body: JSON.stringify({ id: a.id }) });
    expect(r.status).toBe(403);
    expect(await blocks()).toHaveLength(1);
    expect(await cancelsAll()).toHaveLength(0);
  });
});

describe('5. 営業時間を短くする前に、はみ出る予約を知らせて止める', () => {
  it('18時→15時：16:00 の LINE・電話の予約がはみ出る → 409 outside。営業時間は 18時のまま', async () => {
    const id = await man('16:00', '17:00');
    const r = await admin('POST', 'hours', { date: DAY, s: '10:00', e: '15:00' });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.outside).toEqual([{ id, s: '16:00', e: '17:00', kind: 'man' }]);
    expect(j.error).toContain('16:00〜17:00');
    expect(await hoursOf()).toMatchObject({ s: '10:00', e: '18:00' });
  });

  it('始まりを遅くするとき（10時→12時）：10:00 のネット予約がはみ出る → 409。（ネット）と書く', async () => {
    await book('10:00');
    const r = await admin('POST', 'hours', { date: DAY, s: '12:00', e: '18:00' });
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.outside).toHaveLength(1);
    expect(j.outside[0].kind).toBe('net');
    expect(j.error).toContain('（ネット）');
    expect(await hoursOf()).toMatchObject({ s: '10:00', e: '18:00' });
  });

  it('はみ出ないなら、短くしても今までどおり変わる（確認は出ない）', async () => {
    await man('11:00', '12:00');
    expect((await admin('POST', 'hours', { date: DAY, s: '10:00', e: '15:00' })).status).toBe(200);
    expect(await hoursOf()).toMatchObject({ s: '10:00', e: '15:00' });
  });

  it('終わりのあとの片づけの分（bufferMin）だけ出る予約は、はみ出たと数えない（手入力のときと同じ物差し）', async () => {
    await man('14:00', '15:' + String(BUF).padStart(2, '0'));
    expect((await admin('POST', 'hours', { date: DAY, s: '10:00', e: '15:00' })).status).toBe(200);
  });

  it('ネット予約は片づけの分も許さない（受付と同じ物差し）：14:00〜15:00 のネット予約があるのに 14:50 までにすると 409', async () => {
    await book('14:00');
    const r = await admin('POST', 'hours', { date: DAY, s: '10:00', e: '14:50' });
    expect(r.status).toBe(409);
    expect(await hoursOf()).toMatchObject({ s: '10:00', e: '18:00' });
    expect((await admin('POST', 'hours', { date: DAY, s: '10:00', e: '15:00' })).status).toBe(200);   // ちょうど終わりまでなら通る
  });

  it('予約停止は数えない（はみ出ても止めない）。長くするのはいつでもできる', async () => {
    await stop('16:00', '17:00');
    expect((await admin('POST', 'hours', { date: DAY, s: '10:00', e: '15:00' })).status).toBe(200);
    expect((await admin('POST', 'hours', { date: DAY, s: '09:00', e: '20:00' })).status).toBe(200);
  });

  it('新しく営業日を入れる日（予約なし）は今までどおり', async () => {
    expect((await admin('POST', 'hours', { date: '2027-04-16', s: '13:00', e: '18:00' })).status).toBe(200);
  });
});
