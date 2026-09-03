@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo   ???? 3D ??? - ?????
echo ========================================
echo.

REM ?? Python
where python >nul 2>&1
if not errorlevel 1 goto :python_ok

where py >nul 2>&1
if not errorlevel 1 goto :py_ok

where npx >nul 2>&1
if not errorlevel 1 goto :npx_ok

echo [??] ???? Python ? Node.js
echo ??? Python ( https://www.python.org/ ) ? Node.js ( https://nodejs.org/ )
echo.
pause
exit /b 1

:python_ok
echo [??] ?? Python http.server
start "" "http://localhost:8000"
python -m http.server 8000
goto :end

:py_ok
echo [??] ?? py -m http.server
start "" "http://localhost:8000"
py -m http.server 8000
goto :end

:npx_ok
echo [??] ?? npx serve
start "" "http://localhost:3000"
npx --yes serve -l 3000 .

:end
echo.
echo ???????????
pause >nul
