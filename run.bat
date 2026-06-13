@echo off
setlocal enabledelayedexpansion
title Ideogram 4.0 Local Studio
echo.
echo ================================================================
echo   Ideogram 4.0 Local Studio
echo ================================================================
echo.

:: == Preflight ===================================================
if not exist venv\Scripts\activate.bat (
    echo [ERROR] Python environment not found - run install.bat first.
    pause
    exit /b 1
)
if not exist frontend\dist\index.html (
    echo [ERROR] Web interface not built - run install.bat first.
    pause
    exit /b 1
)

:: Port 8000 already in use? (another copy probably running)
netstat -ano 2>nul | findstr "LISTENING" | findstr ":8000 " >nul 2>&1
if not errorlevel 1 (
    echo [ERROR] Port 8000 is already in use.
    echo         The studio may already be running in another window -
    echo         check http://localhost:8000 or close the other window.
    pause
    exit /b 1
)

:: == HF_TOKEN check ==============================================
set _HF_TOKEN_VAL=
if not exist .env goto :hf_missing
for /f "tokens=1,* delims==" %%a in ('findstr /b "HF_TOKEN=" .env 2^>nul') do set _HF_TOKEN_VAL=%%b
if not "!_HF_TOKEN_VAL!"=="" goto :hf_ok

:hf_missing
echo [NOTICE] HF_TOKEN is not set in .env
echo.
echo   The token is required to download model weights on first generation.
echo   Get yours at:   https://huggingface.co/settings/tokens
echo   Accept license: https://huggingface.co/ideogram-ai/ideogram-4-nf4
echo.
set /p _HF_INPUT=  Enter HF_TOKEN now (or press Enter to continue anyway):
if "!_HF_INPUT!"=="" goto :hf_skipped
if exist .env (
    powershell -NoProfile -Command "(Get-Content '.env') -replace '^HF_TOKEN=.*', ('HF_TOKEN=' + $env:_HF_INPUT) | Set-Content '.env'"
) else (
    echo HF_TOKEN=!_HF_INPUT!> .env
)
echo [OK] HF_TOKEN saved to .env
goto :hf_ok

:hf_skipped
echo [WARN] Continuing without HF_TOKEN. You can also add it in the app's
echo        Settings tab - model downloads will fail until it is set.

:hf_ok
echo.
echo Freeing GPU memory held by other apps (Ollama models, if any)...
venv\Scripts\python.exe -c "import sys; sys.path.insert(0, 'backend'); import system_check as sc; s = sc.stop_ollama_models(); print('  Freed: ' + (', '.join(s) if s else 'nothing was using the GPU'))" 2>nul
echo.
echo Starting server... your browser will open automatically.
echo The NF4-D model will load in the background (first run downloads it -
echo  ~16 GB - so the very first launch takes a while; after that it's ready).
echo Watch the Status panel in the app for progress. You can use the app
echo  while it loads.
echo Press Ctrl+C in this window to stop the studio.
echo.

:: == Phone / LAN access ==========================================
:: Bind to 0.0.0.0 so other devices on your Wi-Fi (phone, tablet) can
:: reach the studio. Find this PC's LAN IP and show the URL to type.
set LAN_IP=
for /f "delims=" %%i in ('powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 ^| Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } ^| Sort-Object -Property InterfaceMetric ^| Select-Object -First 1 -ExpandProperty IPAddress" 2^>nul') do set LAN_IP=%%i
echo   On this PC:     http://localhost:8000
if defined LAN_IP (
    echo   On your phone:  http://!LAN_IP!:8000     ^(same Wi-Fi network^)
) else (
    echo   On your phone:  http://^<this-PC-IP^>:8000   ^(run 'ipconfig' to find the IPv4 address^)
)
echo   Note: anyone on your local network can reach the studio while it runs.
echo.
:: Best-effort: open Windows Firewall for port 8000. Needs admin; if this
:: window isn't elevated it's skipped silently and Windows may prompt on the
:: first phone connection instead (click "Allow on Private networks").
netsh advfirewall firewall show rule name="Ideogram Studio 8000" >nul 2>&1 || netsh advfirewall firewall add rule name="Ideogram Studio 8000" dir=in action=allow protocol=TCP localport=8000 profile=private >nul 2>&1

:: Preload the model in the background at startup (see lifespan in main.py).
set PRELOAD_MODEL=true
set PRELOAD_VARIANT=nf4d
call venv\Scripts\activate.bat
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 --log-level info
set EXITCODE=%errorlevel%
cd ..
if not "%EXITCODE%"=="0" (
    echo.
    echo [ERROR] The server stopped unexpectedly (exit code %EXITCODE%).
    echo         Scroll up for the error message.
    pause
)
