# デプロイ用フォルダ（deploy）を、今のファイルから作り直す
# 使い方：agriWebApps フォルダで  .\デプロイ用フォルダを作る.ps1
#         そのまま公開するなら   .\デプロイ用フォルダを作る.ps1 -Deploy
# ふだんは、GitHub の main に入れると自動で公開される（README の「公開」を参照）。これは手動で公開したいとき用
param([switch]$Deploy)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

try {
  # 公開するファイルを deploy フォルダに集める（自動公開と同じスクリプトを使う）
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js が見つかりません。Node.js を入れてから、もう一度実行してください" }
  node (Join-Path $root "tools\build-site.mjs")
  if ($LASTEXITCODE -ne 0) { throw "deploy フォルダを作れませんでした" }

  if ($Deploy) {
    # 公開の設定は、このフォルダ直下の wrangler.jsonc を使う
    Push-Location $root
    try {
      npx.cmd wrangler deploy
      if ($LASTEXITCODE -ne 0) { throw "公開に失敗しました（wrangler deploy）" }
    } finally { Pop-Location }
  } else {
    Write-Host "公開するときは：npx wrangler deploy（または -Deploy を付けて再実行）"
  }
} catch {
  Write-Host "失敗しました：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
