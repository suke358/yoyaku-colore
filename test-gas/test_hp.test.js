// colore の HP をテスト用の予約システムで出す部品（test-kankyou/hp.mjs）の確かめ（Node。2026/11/03）
// 置きかえ・置きかえ残しで止まる・出さないファイル。HP の本物のファイルは読むだけ（../colore-website があるときだけ、その中身でも確かめる）
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewriteHp, leftovers, checkHpDir, fileFor, PROD_ORIGIN } from '../test-kankyou/hp.mjs';

const T = 'http://127.0.0.1:8790';

describe('HP の住所の置きかえ', () => {
  it('/api/ は HP と同じ住所に、ほか（予約ページ・/cancel）はテスト用の予約システムに', () => {
    const src = `var API='${PROD_ORIGIN}/api/days';var BOOK='${PROD_ORIGIN}/api/book';<a href="${PROD_ORIGIN}/">開く</a><a href="${PROD_ORIGIN}/cancel">取り消し</a>`;
    const out = rewriteHp(src, T);
    expect(out).toBe(`var API='/api/days';var BOOK='/api/book';<a href="${T}/">開く</a><a href="${T}/cancel">取り消し</a>`);
    expect(leftovers(out)).toEqual([]);
  });
  it('置きかえられない書き方（https なし・別の予約システム）は「残り」として見つける', () => {
    expect(leftovers(rewriteHp(`fetch('//yoyaku-colore.liftoff-358.workers.dev/api/days')`, T)).length).toBe(1);
    expect(leftovers(rewriteHp(`<a href="https://yoyaku-demo.liftoff-358.workers.dev/">`, T)).length).toBe(1);
    expect(leftovers(rewriteHp(`<a href="https://liftoff-hp.liftoff-358.workers.dev/">`, T))).toEqual([]);   // 予約ではない住所はそのまま
  });
  it('置きかえ残しがある HP は、checkHpDir が理由を返す（start.mjs はこれで止まる）', () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'hp-'));
    writeFileSync(path.join(d, 'index.html'), `<script>var A='${PROD_ORIGIN}/api/days'</script>`);
    expect(checkHpDir(d)).toEqual([]);
    mkdirSync(path.join(d, 'sub'));
    writeFileSync(path.join(d, 'sub', 'x.html'), `<a href="http://yoyaku-colore.liftoff-358.workers.dev/">`);
    expect(checkHpDir(d).length).toBeGreaterThan(0);
    expect(checkHpDir(path.join(d, 'nai'))[0]).toMatch(/index\.html がありません/);
  });
  it('出さないファイル：外（..）・隠しファイル（.git）・worker.js・wrangler.jsonc・README.md', () => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'hp-'));
    for (const f of ['index.html', 'worker.js', 'wrangler.jsonc', 'README.md', 'style.css']) writeFileSync(path.join(d, f), 'x');
    mkdirSync(path.join(d, '.git')); writeFileSync(path.join(d, '.git', 'config'), 'x');
    expect(fileFor(d, '/')).toBe(path.join(d, 'index.html'));
    expect(fileFor(d, '/style.css?v=2')).toBe(path.join(d, 'style.css'));
    for (const p of ['/worker.js', '/wrangler.jsonc', '/README.md', '/.git/config', '/../x', '/%2e%2e/x', '/%00']) expect(fileFor(d, p)).toBeNull();
  });
  const real = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'colore-website');
  it.skipIf(!existsSync(path.join(real, 'index.html')))('となりの colore-website の HP は、置きかえ残しがない', () => {
    expect(checkHpDir(real)).toEqual([]);
  });
});
