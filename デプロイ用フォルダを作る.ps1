# デプロイ用フォルダ（deploy）を、今のファイルから作り直す
# 使い方：agriWebApps フォルダで  .\デプロイ用フォルダを作る.ps1
#         そのまま公開するなら   .\デプロイ用フォルダを作る.ps1 -Deploy
param([switch]$Deploy)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dst  = Join-Path $root "deploy"

try {
  # wrangler の設定だけは、作り直しても消えないよう別に控えておく
  $keep = @{}
  foreach ($n in "wrangler.jsonc", ".assetsignore") {
    $p = Join-Path $dst $n
    if (Test-Path $p) { $keep[$n] = Get-Content $p -Raw -Encoding UTF8 }
  }
  if (-not $keep.ContainsKey("wrangler.jsonc")) {
    $keep["wrangler.jsonc"] = @'
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "tanbo-ledger",
  "compatibility_date": "2026-11-04",
  "observability": { "enabled": true },
  "assets": { "directory": "." }
}
'@
  }
  if (-not $keep.ContainsKey(".assetsignore")) {
    $keep[".assetsignore"] = ".wrangler`n.dev.vars*`n.env*`nnode_modules`n.git`n.DS_Store`n.npmrc`n"
  }

  # いったん空にして、必要なものだけをコピーする（古いファイルが残らないように）
  if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
  New-Item -ItemType Directory $dst | Out-Null
  foreach ($f in "index.html", "privacy.html") { Copy-Item (Join-Path $root $f) $dst }
  foreach ($d in "assets", "css", "js") { Copy-Item -Recurse (Join-Path $root $d) $dst }
  foreach ($k in $keep.Keys) { [IO.File]::WriteAllText((Join-Path $dst $k), $keep[$k], (New-Object Text.UTF8Encoding($false))) }

  # 念のため、秘密情報が紛れ込んでいないか確かめる
  $bad = Get-ChildItem -Recurse -Force -File $dst | Where-Object { $_.Name -match '^\.dev\.vars|^\.env' -and $_.Name -notmatch 'example$' }
  if ($bad) { throw "秘密情報らしきファイルが入っています：$($bad.FullName -join ', ')" }

  $n = (Get-ChildItem -Recurse -File $dst).Count
  Write-Host "deploy フォルダを作りました（$n ファイル）" -ForegroundColor Green

  if ($Deploy) {
    Push-Location $dst
    try { npx.cmd wrangler deploy } finally { Pop-Location }
  } else {
    Write-Host "公開するときは：cd deploy → npx wrangler deploy（または -Deploy を付けて再実行）"
  }
} catch {
  Write-Host "失敗しました：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
