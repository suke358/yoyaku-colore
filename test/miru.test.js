// 見る専用の合言葉のテスト（2026/11/01）。守ること：
//   見る用の合言葉（VIEW_PASSWORD）で「読む」はできる／「変える」は全部 403 で、D1 は変わらない
//   お店の合言葉（ADMIN_PASSWORD）は今までどおり全部できる／違う合言葉は今までどおり 401
//   画面 public/miru.html は、変える命令（hours・block・settings、DELETE）を書いていない
import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import miruHtml from '../public/miru.html?raw';

const ADMIN = 'test-admin-password';   // vitest.config.js の bindings と同じ
const VIEW = 'test-view-password';
const DAY = '2027-04-15';

const call = (pw, method, path, body) => SELF.fetch('https://x/api/admin/' + path, {
  method, headers: { 'content-type': 'application/json', 'X-Admin-Password': pw }, body: body === undefined ? undefined : JSON.stringify(body)
});
const count = async () => {
  const b = await env.DB.prepare('SELECT COUNT(*) AS n FROM blocks').first();
  const h = await env.DB.prepare('SELECT COUNT(*) AS n FROM hours').first();
  const s = await env.DB.prepare('SELECT COUNT(*) AS n FROM settings').first();
  return { b: b.n, h: h.n, s: s.n };
};

beforeEach(async () => {
  await SELF.fetch('https://x/api/days');   // 表を作る
  await env.DB.batch([env.DB.prepare('DELETE FROM blocks'), env.DB.prepare('DELETE FROM hours'), env.DB.prepare('DELETE FROM auth_fail')]);
  // お店の合言葉で、営業時間と予約を1つずつ入れておく
  expect((await call(ADMIN, 'POST', 'hours', { date: DAY, s: '10:00', e: '18:00' })).status).toBe(200);
  expect((await call(ADMIN, 'POST', 'block', { date: DAY, s: '11:00', e: '12:00', menu: 'テスト', name: '見る 花子' })).status).toBe(200);
});

describe('見る専用の合言葉', () => {
  it('入れる（role は miru）。お店の合言葉は role mise', async () => {
    const r = await call(VIEW, 'POST', 'login', {});
    expect(r.status).toBe(200);
    expect((await r.json()).role).toBe('miru');
    expect((await (await call(ADMIN, 'POST', 'login', {})).json()).role).toBe('mise');
  });

  it('予約を読める（名前も見える）', async () => {
    const r = await call(VIEW, 'GET', 'all');
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.blocks.some((b) => b.date === DAY && b.name === '見る 花子')).toBe(true);
    expect(j.hours.some((h) => h.date === DAY)).toBe(true);
  });

  it('変える命令は全部 403 で、D1 は1つも変わらない', async () => {
    const before = await count();
    const id = (await env.DB.prepare('SELECT id FROM blocks LIMIT 1').first()).id;
    const tries = [
      ['POST', 'hours', { date: DAY, s: '09:00', e: '20:00' }],
      ['POST', 'hours', { date: '2027-04-16', s: '10:00', e: '18:00' }],
      ['DELETE', 'hours', { date: DAY }],
      ['POST', 'block', { date: DAY, s: '14:00', e: '15:00', kind: 'stop' }],
      ['POST', 'block', { date: DAY, s: '15:00', e: '16:00', kind: 'man', name: 'x' }],
      ['DELETE', 'block', { id }],
      ['POST', 'settings', { key: 'kata', value: { a: 1 } }],
      ['PUT', 'all', {}],
      ['DELETE', 'all', {}]
    ];
    for (const [m, p, body] of tries) {
      const r = await call(VIEW, m, p, body);
      expect(r.status, m + ' ' + p).toBe(403);
    }
    expect(await count()).toEqual(before);
    const h = await env.DB.prepare('SELECT s, e FROM hours WHERE date = ?1').bind(DAY).first();
    expect(h).toEqual({ s: '10:00', e: '18:00' });
  });

  it('お店の合言葉は今までどおり変えられる（見る専用を足しても壊れていない）', async () => {
    expect((await call(ADMIN, 'POST', 'hours', { date: DAY, s: '09:00', e: '19:00' })).status).toBe(200);
    expect((await call(ADMIN, 'POST', 'block', { date: DAY, s: '14:00', e: '15:00', kind: 'stop' })).status).toBe(200);
    const id = (await env.DB.prepare("SELECT id FROM blocks WHERE kind = 'stop'").first()).id;
    expect((await call(ADMIN, 'DELETE', 'block', { id })).status).toBe(200);
  });

  it('違う合言葉は今までどおり 401（見る用と1文字違いでも）', async () => {
    expect((await call(VIEW + 'x', 'GET', 'all')).status).toBe(401);
    expect((await call('', 'GET', 'all')).status).toBe(401);
  });
});

describe('見る専用の画面 /miru', () => {
  it('開ける', async () => {
    const r = await SELF.fetch('https://x/miru');
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('予約を見る');
  });
  it('画面に、変える命令を書いていない（login と all だけ）', () => {
    const calls = miruHtml.match(/api\("([a-z]+)"/g) || [];
    expect(calls.sort()).toEqual(['api("all"', 'api("login"']);
    expect(miruHtml).not.toMatch(/"DELETE"|'DELETE'|"PUT"/);
    expect(miruHtml).not.toMatch(/api\/admin\/(hours|block|settings)/);
  });
});
