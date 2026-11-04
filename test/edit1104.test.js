// 入れた予約を直す（PUT /api/admin/block。2026/11/04）のテスト。GAS は偽物の fetch が受け止める（本物には送らない）
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


const DAY2 = '2027-04-16';
const rowOf = async (id) => env.DB.prepare('SELECT * FROM blocks WHERE id = ?1').bind(id).first();
const put = (body) => admin('PUT', 'block', body);

describe('入れた予約を直す', () => {
  it('時間・名前・メニューを直せる。HP の /api/days の埋まっている時間も変わる', async () => {
    const id = await man('10:00', '11:00', '山田');
    const r = await put({ id, date: DAY, s: '13:00', e: '14:10', name: '佐藤', menu: 'フェイシャル' });
    expect(r.status).toBe(200);
    const x = await rowOf(id);
    expect([x.s, x.e, x.name, x.menu, x.kind]).toEqual(['13:00', '14:10', '佐藤', 'フェイシャル', 'man']);
    const d = await (await api('/api/days')).json();
    expect(d.busy[DAY]).toEqual([{ s: '13:00', e: '14:10', kind: 'busy' }]);
  });
  it('名前・メニューを送らなければ今のまま', async () => {
    const id = await man('10:00', '11:00', '山田');
    expect((await put({ id, date: DAY, s: '10:30', e: '11:30' })).status).toBe(200);
    const x = await rowOf(id);
    expect([x.s, x.name, x.menu]).toEqual(['10:30', '山田', 'よもぎ蒸し']);
  });
  it('ほかの予約と重なると 409 で、元のまま。自分の元の時間と重なるのは大丈夫', async () => {
    const a = await man('10:00', '11:00'); await man('12:00', '13:00');
    expect((await put({ id: a, date: DAY, s: '11:30', e: '12:30' })).status).toBe(409);
    expect((await rowOf(a)).s).toBe('10:00');
    expect((await put({ id: a, date: DAY, s: '10:30', e: '11:30' })).status).toBe(200);
  });
  it('ネット予約・予約停止とも重ならない', async () => {
    const a = await man('10:00', '11:00'); await book('14:00'); await stop('16:00', '17:00');
    expect((await put({ id: a, date: DAY, s: '14:30', e: '15:00' })).status).toBe(409);
    expect((await put({ id: a, date: DAY, s: '16:30', e: '17:30' })).status).toBe(409);
    expect((await rowOf(a)).s).toBe('10:00');
  });
  it('ほかの日へ動かせる（その日の営業時間の中だけ。休みの日は 400）', async () => {
    const a = await man('10:00', '11:00');
    expect((await put({ id: a, date: DAY2, s: '10:00', e: '11:00' })).status).toBe(400);   // DAY2 は営業時間なし
    expect((await admin('POST', 'hours', { date: DAY2, s: '12:00', e: '18:00' })).status).toBe(200);
    expect((await put({ id: a, date: DAY2, s: '10:00', e: '11:00' })).status).toBe(400);   // 営業時間の外
    expect((await put({ id: a, date: DAY2, s: '12:00', e: '13:00' })).status).toBe(200);
    expect((await rowOf(a)).date).toBe(DAY2);
    expect(await blocks()).toEqual([]);
  });
  it('終わりは営業の終わり＋片づけまで（入れるときと同じ物差し）', async () => {
    const a = await man('10:00', '11:00');
    expect((await put({ id: a, date: DAY, s: '17:00', e: '18:' + String(BUF + 1).padStart(2, '0') })).status).toBe(400);
    expect((await put({ id: a, date: DAY, s: '17:00', e: '18:' + String(BUF).padStart(2, '0') })).status).toBe(200);
  });
  it('ネット予約は直さない（409）。中身はそのまま', async () => {
    const b = await book('14:00');
    const before = await rowOf(b.id);
    const r = await put({ id: b.id, date: DAY, s: '15:00', e: '16:00' });
    expect(r.status).toBe(409);
    expect(await rowOf(b.id)).toEqual(before);
  });
  it('予約停止も直せる（名前・メニューは空のまま）', async () => {
    const a = await stop('10:00', '11:00');
    expect((await put({ id: a, date: DAY, s: '12:00', e: '12:30', name: 'x', menu: 'y' })).status).toBe(200);
    const x = await rowOf(a);
    expect([x.s, x.e, x.kind, x.name, x.menu]).toEqual(['12:00', '12:30', 'stop', '', '']);
  });
  it('ない id は 404・入力の形が違えば 400', async () => {
    expect((await put({ id: 'nai', date: DAY, s: '10:00', e: '11:00' })).status).toBe(404);
    const a = await man('10:00', '11:00');
    expect((await put({ id: a, date: '2027/4/15', s: '10:00', e: '11:00' })).status).toBe(400);
    expect((await put({ id: a, date: DAY, s: '11:00', e: '10:00' })).status).toBe(400);
    expect((await put({ date: DAY, s: '10:00', e: '11:00' })).status).toBe(400);
  });
  it('合言葉なしは 401・見る専用の合言葉では 403（変えない）', async () => {
    const a = await man('10:00', '11:00');
    const no = await api('/api/admin/block', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: a, date: DAY, s: '12:00', e: '13:00' }) });
    expect(no.status).toBe(401);
    const v = await api('/api/admin/block', { method: 'PUT', headers: { 'content-type': 'application/json', 'X-Admin-Password': 'test-view-password' }, body: JSON.stringify({ id: a, date: DAY, s: '12:00', e: '13:00' }) });
    expect(v.status).toBe(403);
    expect((await rowOf(a)).s).toBe('10:00');
  });
  it('名前は 40 文字まで', async () => {
    const a = await man('10:00', '11:00');
    expect((await put({ id: a, date: DAY, s: '10:00', e: '11:00', name: 'あ'.repeat(60) })).status).toBe(200);
    expect((await rowOf(a)).name.length).toBe(40);
  });
  it('「10:90」のような時刻は 400（文字の比べで重なりをすり抜けないように。入れるときも同じ）', async () => {
    const a = await man('10:00', '10:30'); await man('11:00', '11:30');
    expect((await put({ id: a, date: DAY, s: '10:30', e: '10:90' })).status).toBe(400);
    expect((await admin('POST', 'block', { date: DAY, s: '12:00', e: '12:90' })).status).toBe(400);
    expect((await put({ id: a, date: DAY, s: '9:00', e: '10:00' })).status).toBe(400);
    expect((await rowOf(a)).e).toBe('10:30');
  });
});
