@echo off
setlocal enabledelayedexpansion
echo.
echo ================================================================
echo   Ideogram 4.0 Local Studio
echo ================================================================
echo.

:: Pre-flight: HF_TOKEN check
set _HF_TOKEN_VAL=
if not exist .env goto :hf_missing
for /f "tokens=1,* delims==" %%a in ('findstr /b "HF_TOKEN=" .env 2^>nul') do set _HF_TOKEN_VAL=%%b
if not "!_HF_TOKEN_VAL!"=="" goto :hf_ok

:hf_missing
echo [NOTICE] HF_TOKEN is not set in .env
echo.
echo   This token is required to download model weights on first generation.
echo   Get yours at:  https://huggingface.co/settings/tokens
echo   Accept license: https://huggingface.co/ideogram-ai/ideogram-4-fp8
echo.
set /p _HF_INPUT=  Enter HF_TOKEN now (or press Enter to continue anyway):
if "!_HF_INPUT!"=="" goto :hf_skipped
if exist .env (
    powershell -Command "(Get-Content .env) -replace '^HF_TOKEN=.*','HF_TOKEN=!_HF_INPUT!' | Set-Content .env"
) else (
    echo HF_TOKEN=!_HF_INPUT!> .env
)
echo [OK] HF_TOKEN saved to .env
goto :hf_ok

:hf_skipped
echo [WARN] Continuing without HF_TOKEN. Generation will fail on first model download.

:hf_ok
echo Starting server...
echo Opening at http://localhost:8000 in a moment.
echo Press Ctrl+C to stop the server.
echo.
call venv\Scripts\activate.bat
cd backend
start "" http://localhost:8000
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 --log-level info
