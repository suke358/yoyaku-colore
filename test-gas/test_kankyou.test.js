// テスト用の予約システム（test-kankyou/）の安全の確かめ（Node。2026/11/03）。push のたびの自動チェックでも回る
// 本番の D1・KV の番号、本物の GAS の URL が、テスト用の設定に入っていないこと。偽物のメール係が Code.gs の doPost をそのまま使うこと
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { safetyProblems } from '../test-kankyou/kankyou.mjs';

const strip = (t) => JSON.parse(t.replace(/^\s*\/\/.*$/gm, '').replace(/[ \t]+\/\/[^"\n]*$/gm, ''));
const prod = strip(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const testRaw = readFileSync(new URL('../test-kankyou/wrangler.test.jsonc', import.meta.url), 'utf8');
const test = strip(testRaw);

describe('テスト用の予約システムの設定', () => {
  it('安全の確かめに引っかからない', () => {
    expect(safetyProblems()).toEqual([]);
  });
  it('D1・KV の番号と名前が本番とちがう', () => {
    expect(test.name).not.toBe(prod.name);
    expect(test.d1_databases[0].database_id).not.toBe(prod.d1_databases[0].database_id);
    expect(test.d1_databases[0].database_name).not.toBe(prod.d1_databases[0].database_name);
    expect(test.kv_namespaces[0].id).not.toBe(prod.kv_namespaces[0].id);
  });
  it('メールの係は手元の偽物（127.0.0.1）。本物の GAS の URL はない', () => {
    expect(test.vars.GAS_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/exec$/);
    expect(testRaw).not.toMatch(/script\.google/);
  });
  it('安全の確かめは、本物の GAS の URL を渡されたら止める', () => {
    expect(safetyProblems({ gasUrl: 'https://script.google.com/macros/s/x/exec' }).length).toBeGreaterThan(0);
  });
  it('画面と API は本番と同じファイルを使う（../public・../src/worker.js）', () => {
    expect(test.main).toBe('../' + prod.main);
    expect(test.assets.directory).toBe('../' + prod.assets.directory.replace(/^\.\//, ''));
  });
  it('偽物のメール係は gas/Code.gs を読みこみ、MailApp を偽物にしている（外に送る道具を使わない）', () => {
    const src = readFileSync(new URL('../test-kankyou/fake_gas.mjs', import.meta.url), 'utf8');
    expect(src).toContain("'gas', 'Code.gs'");
    expect(src).not.toMatch(/https:\/\//);
    expect(src).toMatch(/listen\(PORT, '127\.0\.0\.1'/);
  });
});
