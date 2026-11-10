# tanbo-backup（帳簿アプリの自動バックアップ）

Google ドライブの共有ファイル（`sharedFolder.json`）を、毎日、日本時間の 1:00 に、ドライブの「バックアップ」フォルダへフル／増分で保存する Cloudflare Worker です。

- 使い方・設定：**`設定手順書.md`**（初心者向け）
- 復元：**`復元手順書.md`**
- 静的サイト `tanbo-ledger` とは**別の Worker**です（デプロイしても、アプリ本体には影響しません）

## 構成

| ファイル | 役割 |
|---|---|
| `../js/backupchain.js` | フル／増分の作成・当てはめ・復元の共通部品（アプリ・Worker・復元コマンドで同じものを使う） |
| `src/index.js` | cron の入り口。やり直し・ntfy 通知 |
| `src/run.js` | 1回の実行（共有ファイルを読む → フル／増分を決める → 保存 → 古いものを整理） |
| `src/drive.js` | Google ドライブの操作（OAuth リフレッシュトークン。一時的な失敗は自動で再試行） |
| `src/wcrypto.js` | 暗号化（アプリと同じ AES-256-GCM 形式） |
| `src/notify.js` | ntfy への通知 |
| `tools/restore.mjs` | 復元コマンド |
| `test/` | テスト（`npm test`） |

## 動き方

1. 共有ファイルを読む（パスワード暗号化なら、秘密情報 `DATA_KEY` の鍵で開く）
2. 日本時間の日曜ならフル、ほかは増分（`FULL_DAY` で変更可。cron の曜日ではなく、コードで日本時間に直して判定）
3. フォルダの中のフル＋増分から「前回の状態」を作り直す（別の保管場所を持たない）。鎖が切れていたら、フルを取り直す
4. 保存（同じ日は上書き）。大きさを確認する
5. フルが保存できたときだけ、古いフル・増分をゴミ箱へ

## 手動実行（手元）

```powershell
npx wrangler dev --test-scheduled
# 別のウィンドウで
Invoke-WebRequest "http://localhost:8787/cdn-cgi/handler/scheduled?cron=dry-run" -UseBasicParsing       # 計画だけ（何も保存しない）
Invoke-WebRequest "http://localhost:8787/cdn-cgi/handler/scheduled?cron=force-full" -UseBasicParsing    # フルを取る
Invoke-WebRequest "http://localhost:8787/cdn-cgi/handler/scheduled?cron=force-incr" -UseBasicParsing    # 増分を取る
Invoke-WebRequest "http://localhost:8787/cdn-cgi/handler/scheduled?time=1794067200000" -UseBasicParsing # その時刻（ミリ秒）に動いたことにして実行（この値は 2026-11-08 日曜 1:00 日本時間）
```

## テスト

```powershell
npm test                          # 30件（共通ロジック／実行の流れ／本物の通信コード）
node test/e2e-wrangler.mjs        # wrangler dev（本物の Worker 実行環境）で、模擬 Google サーバーにつないで通し確認
node test/perf.mjs 100 1 15       # 1回の処理時間の目安（引数：追加する記録の件数 暗号化 繰り返し）
```

## 秘密情報（`wrangler secret put` で登録。コードや Git には入れない）

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` / `DATA_KEY`（暗号化しているときだけ）/ `NTFY_TOPIC`
