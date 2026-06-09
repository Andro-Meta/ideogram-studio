@echo off
setlocal enabledelayedexpansion
title Ideogram 4.0 Local Studio - Installer
echo.
echo ================================================================
echo   Ideogram 4.0 Local Studio  -  Installation
echo ================================================================
echo.
if /i "%~1"=="/force" (set FORCE=1) else (set FORCE=0)

:: == Prerequisites ===============================================
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+ from https://python.org
    echo         IMPORTANT: tick "Add python.exe to PATH" in the installer.
    pause
    exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
for /f "tokens=1,2 delims=." %%a in ("!PY_VER!") do (
    set PY_MAJOR=%%a
    set PY_MINOR=%%b
)
if !PY_MAJOR! LSS 3 goto :py_too_old
if !PY_MAJOR! EQU 3 if !PY_MINOR! LSS 10 goto :py_too_old
echo [OK] Python !PY_VER!
goto :py_ok
:py_too_old
echo [ERROR] Python !PY_VER! is too old - this app needs Python 3.10 or newer.
pause
exit /b 1
:py_ok

node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install the LTS version from https://nodejs.org
    pause
    exit /b 1
)
for /f %%v in ('node --version 2^>^&1') do set NODE_VER=%%v
echo [OK] Node.js !NODE_VER!

:: GPU check - warn only, never block
set GPU_NAME=
for /f "skip=1 delims=" %%g in ('nvidia-smi --query-gpu^=name --format^=csv 2^>nul') do (
    if not defined GPU_NAME set GPU_NAME=%%g
)
if defined GPU_NAME (
    echo [OK] GPU: !GPU_NAME!
) else (
    echo [WARN] No NVIDIA GPU/driver detected ^(nvidia-smi not found^).
    echo        Image generation requires a CUDA GPU. Continuing anyway.
)

:: Free disk space - deps ~8 GB now, nf4 model weights ~14 GB later
set FREE_GB=
for /f %%f in ('powershell -NoProfile -Command "[math]::Floor((Get-PSDrive ((Get-Location).Drive.Name)).Free/1GB)" 2^>nul') do set FREE_GB=%%f
if defined FREE_GB (
    echo [OK] Free disk space on this drive: !FREE_GB! GB
    if !FREE_GB! LSS 25 (
        echo [WARN] Less than 25 GB free. Dependencies need ~8 GB and the
        echo        nf4 model weights need ~14 GB more on first generation.
    )
)

:: == Environment file ============================================
if not exist .env (
    copy .env.example .env >nul
    echo [OK] .env created from template.
) else (
    echo [OK] .env already exists.
)
if not exist outputs mkdir outputs

:: == API key wizard (before downloads so the rest runs unattended)
echo.
echo ================================================================
echo   Setup: API Keys
echo ================================================================

set _CURRENT_HF=
for /f "tokens=1,* delims==" %%a in ('findstr /b "HF_TOKEN=" .env 2^>nul') do set _CURRENT_HF=%%b
echo.
if not "!_CURRENT_HF!"=="" goto :hf_already_set
echo Step 1 of 2: HuggingFace Token (required to download the model)
echo.
echo   Opening your browser to the HuggingFace token page...
echo   Log in, click "New token", choose Read access, copy the token.
echo   You must ALSO accept the model license - opening that page too.
echo.
start https://huggingface.co/settings/tokens
timeout /t 2 /nobreak >nul
start https://huggingface.co/ideogram-ai/ideogram-4-nf4
echo.
echo   Paste your token below, or press Enter to skip (add it later in
echo   the app's Settings tab).
echo.
set /p _HF_INPUT=  HF_TOKEN:
if "!_HF_INPUT!"=="" goto :hf_skipped
powershell -NoProfile -Command "(Get-Content '.env') -replace '^HF_TOKEN=.*', ('HF_TOKEN=' + $env:_HF_INPUT) | Set-Content '.env'"
echo [OK] HF_TOKEN saved.
goto :hf_done
:hf_skipped
echo [SKIP] Add HF_TOKEN in the app Settings tab before generating.
goto :hf_done
:hf_already_set
echo [OK] HF_TOKEN is already set.
:hf_done

set _CURRENT_IDEOGRAM=
for /f "tokens=1,* delims==" %%a in ('findstr /b "IDEOGRAM_API_KEY=" .env 2^>nul') do set _CURRENT_IDEOGRAM=%%b
echo.
if not "!_CURRENT_IDEOGRAM!"=="" goto :ideogram_already_set
echo Step 2 of 2: Ideogram API Key (optional - enables Magic Prompt)
echo.
echo   Magic Prompt rewrites plain English into the structured JSON
echo   captions the model expects. Free to use. Opening the API page...
echo.
start https://ideogram.ai/api?intent=api^&source=api-doc
echo.
echo   Paste your key below, or press Enter to skip.
echo.
set /p _IDEOGRAM_INPUT=  IDEOGRAM_API_KEY:
if "!_IDEOGRAM_INPUT!"=="" goto :ideogram_skipped
powershell -NoProfile -Command "(Get-Content '.env') -replace '^IDEOGRAM_API_KEY=.*', ('IDEOGRAM_API_KEY=' + $env:_IDEOGRAM_INPUT) | Set-Content '.env'"
echo [OK] IDEOGRAM_API_KEY saved.
goto :ideogram_done
:ideogram_skipped
echo [SKIP] Magic Prompt disabled. Add the key in the app Settings tab later.
goto :ideogram_done
:ideogram_already_set
echo [OK] IDEOGRAM_API_KEY is already set.
:ideogram_done

:: == Python dependencies =========================================
if exist venv\.install_complete if !FORCE!==0 (
    echo.
    echo [OK] Python dependencies already installed - skipping.
    echo      ^(Run "install.bat /force" to reinstall from scratch.^)
    goto :frontend
)

echo.
echo ================================================================
echo   Installing Python dependencies (15-30 min, logged to install.log)
echo ================================================================
echo Started %date% %time% > install.log

echo.
echo [1/5] Creating Python virtual environment...
python -m venv venv >> install.log 2>&1
if errorlevel 1 goto :pip_fail
call venv\Scripts\activate.bat
python -m pip install --upgrade pip >> install.log 2>&1

echo [2/5] Installing PyTorch with CUDA support (~2 GB download)...
pip install "torch>=2.12.0" --index-url https://download.pytorch.org/whl/cu126 >> install.log 2>&1
if errorlevel 1 (
    echo [WARN] CUDA 12.6 wheel failed - trying default PyTorch index...
    pip install "torch>=2.12.0" >> install.log 2>&1
    if errorlevel 1 goto :pip_fail
)

echo [3/5] Installing the official Ideogram 4 inference package...
pip install git+https://github.com/ideogram-oss/ideogram4.git >> install.log 2>&1
if errorlevel 1 goto :pip_fail

echo [4/5] Installing HuggingFace diffusers (main branch)...
pip install git+https://github.com/huggingface/diffusers.git >> install.log 2>&1
if errorlevel 1 goto :pip_fail

echo [5/5] Installing remaining Python dependencies...
pip install "fastapi>=0.136.0" "uvicorn[standard]>=0.49.0" "aiosqlite>=0.22.1" "pydantic-settings>=2.14.1" "python-dotenv>=1.2.2" python-multipart "transformers>=4.49.0" "safetensors>=0.8.0" "accelerate>=1.13.0" "einops>=0.7.0" sentencepiece pillow "huggingface_hub>=1.18.0" requests "bitsandbytes>=0.49.2" "spandrel>=0.4.2" "aura-sr>=0.0.4" >> install.log 2>&1
if errorlevel 1 goto :pip_fail

echo done > venv\.install_complete
echo [OK] Python environment ready.
goto :frontend

:pip_fail
echo.
echo [ERROR] Python dependency install failed. Last lines of install.log:
echo ----------------------------------------------------------------
powershell -NoProfile -Command "Get-Content install.log -Tail 15"
echo ----------------------------------------------------------------
echo Full log: install.log
pause
exit /b 1

:: == Frontend ====================================================
:frontend
if exist frontend\dist\index.html if exist frontend\node_modules if !FORCE!==0 (
    echo [OK] Frontend already built - skipping.
    goto :done
)
echo.
echo [6/6] Installing and building the web interface...
cd frontend
call npm install --no-fund --no-audit >> ..\install.log 2>&1
if errorlevel 1 (
    cd ..
    goto :npm_fail
)
call npm run build >> ..\install.log 2>&1
if errorlevel 1 (
    cd ..
    goto :npm_fail
)
cd ..
echo [OK] Frontend built.
goto :done

:npm_fail
echo.
echo [ERROR] Frontend build failed. Last lines of install.log:
echo ----------------------------------------------------------------
powershell -NoProfile -Command "Get-Content install.log -Tail 15"
echo ----------------------------------------------------------------
pause
exit /b 1

:done
echo.
echo ================================================================
echo   Installation complete!
echo.
echo   Start the app:  run.bat
echo.
echo   On first generation the app downloads the nf4 model weights
echo   (~14 GB) with a progress bar, after checking your GPU, RAM,
echo   and disk space. Weights are stored in the "models" folder.
echo ================================================================
pause
