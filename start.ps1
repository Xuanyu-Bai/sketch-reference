$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  素描临摹 3D 参考站 - 本地服务器" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""

$port = 8000
$url = "http://localhost:$port"

if (Get-Command python -ErrorAction SilentlyContinue) {
  Write-Host "[启动] 使用 Python http.server" -ForegroundColor Green
  Start-Process $url
  python -m http.server $port
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  Write-Host "[启动] 使用 py -m http.server" -ForegroundColor Green
  Start-Process $url
  py -m http.server $port
} elseif (Get-Command npx -ErrorAction SilentlyContinue) {
  Write-Host "[启动] 使用 npx serve" -ForegroundColor Green
  Start-Process "http://localhost:3000"
  npx --yes serve -l 3000 .
} else {
  Write-Host "[错误] 未检测到 Python 或 Node.js" -ForegroundColor Red
  Read-Host "按回车退出"
  exit 1
}
