# テスト用の予約システム（2026/11/03）

本番と同じ画面・同じ API を、**本番と別の予約表**で手元だけで動かす。メールは外に出さず、「送ったつもりのメール」を画面で見る。
流れ：直した → `npm test`・`npm run e2e`（自動）→ `npm run test-kankyou` で本人が見る → 本番。
使い方の紙：仕事管理/成果物/2026-11-03/HP制作/colore予約_テスト用システムの使い方（11月3日版）.md

| ファイル | 役目 |
|---|---|
| wrangler.test.jsonc | テスト用の設定（D1・KV は手元だけの番号・GAS は偽物・合言葉はテスト用） |
| fake_gas.mjs | 偽物のメール係。gas/Code.gs の doPost をそのまま動かし、MailApp だけ偽物（http://127.0.0.1:8788/ で見る） |
| kankyou.mjs | 安全の確かめと、立ち上げ・止め（start.mjs と e2e.mjs が使う） |
| start.mjs | 本人が見る用（http://127.0.0.1:8790/。予約表は .state/ に残る。`--reset` でまっさら・`--iphone` で同じ Wi-Fi の iPhone から） |
| e2e.mjs | 画面を自動で押すテスト（Playwright。毎回まっさら・ポート 8799/8798） |

- このフォルダに `.dev.vars`・`.env` を置かない（置くと start.mjs が止まる）
- 安全の確かめのテスト：test-gas/test_kankyou.test.js（`npm test` で回る）
