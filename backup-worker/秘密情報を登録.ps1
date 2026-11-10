# 秘密情報（Cloudflare の Worker に渡す値）を、1つずつ登録します。
# 質問に答えて、メモ帳の値を貼り付けて Enter を押してください。（設定手順書の「5. 秘密情報を Cloudflare に登録する」）
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Put-Secret([string]$name, [string]$help) {
  Write-Host ""
  Write-Host "■ $name" -ForegroundColor Cyan
  Write-Host $help
  $v = Read-Host "値を貼り付けて Enter（飛ばすときは、何も入れずに Enter）"
  if ([string]::IsNullOrWhiteSpace($v)) { Write-Host "飛ばしました"; return }
  $v = $v.Trim()
  $v | npx wrangler secret put $name
  if ($LASTEXITCODE -ne 0) { throw "$name の登録に失敗しました。上のメッセージを確認してください。" }
  Write-Host "✔ $name を登録しました" -ForegroundColor Green
}

Write-Host "途中で「Worker がありません。新しく作りますか？」と聞かれたら、Y と答えてください。"
Put-Secret "GOOGLE_CLIENT_ID"     "Google のクライアントID（…apps.googleusercontent.com で終わる文字列）"
Put-Secret "GOOGLE_CLIENT_SECRET" "Google のクライアント シークレット"
Put-Secret "GOOGLE_REFRESH_TOKEN" "OAuth Playground で取った Refresh token（1// で始まる長い文字列）"
Put-Secret "DATA_KEY"             "アプリの「自動バックアップ用の鍵を表示」で出た文字列（全部）。共有ファイルを暗号化していなければ、飛ばしてください"
Put-Secret "NTFY_TOPIC"           "ntfy の通知先のトピック名（推測されにくい名前）。通知が要らなければ、飛ばしてください"

Write-Host ""
Write-Host "登録が終わりました。次は「6. 手元で動作確認する」へ進んでください。" -ForegroundColor Green