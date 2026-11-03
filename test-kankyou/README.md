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
| hp.mjs | colore の HP（既定 ~/src/colore-website）を http://〜:8791/ で出す。HP のファイルは読むだけ。配るときだけ本番の予約の住所を置きかえる（/api/ は HP と同じ住所で取り次ぐ・ほかは :8790）。置きかえ残しがあれば起動を止める（2026/11/03） |
| e2e_hp.mjs | HP の予約欄を自動で押すテスト（`npm run e2e-hp`。予約→メール→取り消し・本番への通信なし・HP のファイルが変わらない。ポート 8796/8795/8797） |

- このフォルダに `.dev.vars`・`.env` を置かない（置くと start.mjs が止まる）
- 安全の確かめのテスト：test-gas/test_kankyou.test.js・test-gas/test_hp.test.js（`npm test` で回る）
- HP を出さないとき：`--no-hp`。HP の場所を変えるとき：`--hp ほかの場所`
