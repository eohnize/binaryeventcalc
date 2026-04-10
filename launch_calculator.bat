@echo off
setlocal
title SwingEdge Launcher
color 0A

echo.
echo  =========================================
echo   SwingEdge Options Calculator
echo  =========================================
echo.

:: ── Working directory = folder containing this .bat ──────────────────────
cd /d "%~dp0"

:: ── Python check ─────────────────────────────────────────────────────────
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Python not found.
    echo  Install Python 3.9+ from https://python.org
    echo  During install, tick "Add Python to PATH".
    echo.
    pause
    exit /b 1
)
echo  Python OK.

:: ── Install packages, ignoring ALL exit codes ────────────────────────────
echo  Installing / verifying packages...
pip install yfinance fastapi uvicorn 2>&1
echo  (pip finished — errors above are usually harmless warnings)
echo.

:: ── Kill anything already on port 8765 ───────────────────────────────────
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8765 "') do (
    taskkill /f /pid %%a >nul 2>&1
)

:: ── Start server in its own window using a temp .bat ─────────────────────
:: Avoids ALL quoting issues with spaces in paths.
set RUNFILE=%TEMP%\swingserver_run.bat
echo @echo off > "%RUNFILE%"
echo title SwingEdge Server — keep this open >> "%RUNFILE%"
echo cd /d "%~dp0" >> "%RUNFILE%"
echo echo  Server starting... >> "%RUNFILE%"
echo echo  DO NOT close this window. >> "%RUNFILE%"
echo echo. >> "%RUNFILE%"
echo python options_calc_server.py >> "%RUNFILE%"
echo echo. >> "%RUNFILE%"
echo echo  SERVER STOPPED. Close window to dismiss. >> "%RUNFILE%"
echo pause >> "%RUNFILE%"

start "SwingEdge Server — keep this open" cmd /k "%RUNFILE%"

:: ── Poll until server responds (up to 20 seconds) ────────────────────────
echo  Waiting for server to start...
set /a tries=0
:waitloop
timeout /t 1 /nobreak >nul
python -c "import urllib.request; urllib.request.urlopen('http://localhost:8765/health', timeout=2)" >nul 2>&1
if %errorlevel% neq 0 (
    set /a tries+=1
    if %tries% lss 20 goto waitloop
    echo.
    echo  [ERROR] Server did not start in 20 seconds.
    echo  Check the "SwingEdge Server" window for the error message.
    echo.
    pause
    exit /b 1
)
echo  Server is live on http://localhost:8765
echo.

:: ── Open as desktop app ───────────────────────────────────────────────────
set OPENED=0

if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    start "" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" --app=http://localhost:8765 --window-size=1300,840
    set OPENED=1
)
if %OPENED%==0 if exist "%PROGRAMFILES%\Google\Chrome\Application\chrome.exe" (
    start "" "%PROGRAMFILES%\Google\Chrome\Application\chrome.exe" --app=http://localhost:8765 --window-size=1300,840
    set OPENED=1
)
if %OPENED%==0 if exist "%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:8765 --window-size=1300,840
    set OPENED=1
)
if %OPENED%==0 if exist "%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe" --app=http://localhost:8765 --window-size=1300,840
    set OPENED=1
)
if %OPENED%==0 (
    start http://localhost:8765
)

echo  Calculator opened.
echo.
echo  =========================================
echo   To STOP the server:
echo   Close the "SwingEdge Server" window.
echo.
echo   This launcher can now be closed safely.
echo  =========================================
echo.
timeout /t 6 /nobreak >nul
endlocal
