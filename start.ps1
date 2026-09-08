$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  素描临摹 3D 参考 - 本地服务器" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

$port = 8000
$url = "http://localhost:$port"

if (Get-Command node -ErrorAction SilentlyContinue) {
  Write-Host "[启动] 使用 Node.js serve.js (支持 Service Worker / PWA)" -ForegroundColor Green
  Start-Process $url
  node serve.js
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  Write-Host "[启动] 使用 Python http.server" -ForegroundColor Green
  Write-Host "  注意: Python 默认 MIME 不支持 Service Worker" -ForegroundColor DarkYellow
  Start-Process $url
  python -m http.server $port
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  Write-Host "[启动] 使用 py http.server" -ForegroundColor Green
  Start-Process $url
  py -m http.server $port
} else {
  Write-Host "[错误] 未检测到 Node.js 或 Python" -ForegroundColor Red
  Read-Host "按回车退出"
  exit 1
}
