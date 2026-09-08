@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo   素描临摹 3D 参考 - 本地服务器
echo ========================================
echo.

where node >nul 2>&1
if not errorlevel 1 goto :node_ok

where python >nul 2>&1
if not errorlevel 1 goto :python_ok

echo [ERROR] 需要 Node.js 或 Python 来运行本地服务器
echo 下载: https://nodejs.org/ 或 https://www.python.org/
pause
exit /b 1

:node_ok
echo [启动] 使用 Node.js serve.js (支持 Service Worker)
start "" "http://localhost:8000"
node serve.js
goto :end

:python_ok
echo [启动] 使用 Python http.server (注意: Service Worker 需要正确的 MIME 类型)
start "" "http://localhost:8000"
python -m http.server 8000

:end
echo.
pause >nul
