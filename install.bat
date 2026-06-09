@echo off
setlocal enabledelayedexpansion
echo.
echo ================================================================
echo   Ideogram 4.0 Local Studio  -  Installation
echo ================================================================
echo.

:: ── Check prerequisites ─────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+ from https://python.org
    pause & exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo [OK] Python %PY_VER%

node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install LTS from https://nodejs.org
    pause & exit /b 1
)
for /f %%v in ('node --version 2^>^&1') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER%

echo.
echo [1/7] Creating Python virtual environment...
python -m venv venv
if errorlevel 1 ( echo [ERROR] venv creation failed & pause & exit /b 1 )

call venv\Scripts\activate.bat
python -m pip install --upgrade pip --quiet

echo.
echo [2/7] Installing PyTorch with CUDA support...
echo       (This downloads ~2 GB. Adjust --index-url if you need a different CUDA version.)
pip install "torch>=2.12.0" --index-url https://download.pytorch.org/whl/cu126 --quiet
if errorlevel 1 (
    echo [WARN] CUDA 12.6 torch failed. Trying default PyTorch index...
    pip install "torch>=2.12.0" --quiet
    if errorlevel 1 ( echo [ERROR] PyTorch install failed & pause & exit /b 1 )
)

echo.
echo [3/7] Installing Ideogram 4 inference package...
pip install git+https://github.com/ideogram-oss/ideogram4.git --quiet
if errorlevel 1 ( echo [ERROR] ideogram4 install failed & pause & exit /b 1 )

echo.
echo [4/7] Installing HuggingFace diffusers (main branch)...
pip install git+https://github.com/huggingface/diffusers.git --quiet
if errorlevel 1 ( echo [ERROR] diffusers install failed & pause & exit /b 1 )

echo.
echo [5/7] Installing remaining Python dependencies...
pip install ^
    "fastapi>=0.136.0" ^
    "uvicorn[standard]>=0.49.0" ^
    "aiosqlite>=0.22.1" ^
    "pydantic-settings>=2.14.1" ^
    "python-dotenv>=1.2.2" ^
    python-multipart ^
    "transformers>=4.49.0" ^
    "safetensors>=0.8.0" ^
    "accelerate>=1.13.0" ^
    "einops>=0.7.0" ^
    sentencepiece ^
    pillow ^
    "huggingface_hub>=1.18.0" ^
    requests ^
    "bitsandbytes>=0.49.2" ^
    "spandrel>=0.4.2" ^
    "aura-sr>=0.0.4" ^
    --quiet
if errorlevel 1 ( echo [ERROR] pip install failed & pause & exit /b 1 )

:: ── Environment file ────────────────────────────────────────────
if not exist .env (
    copy .env.example .env >nul
    echo [OK] .env created from template. Edit it to add your API keys.
) else (
    echo [OK] .env already exists.
)

:: ── Output directory ────────────────────────────────────────────
if not exist outputs mkdir outputs

echo.
echo [6/7] Installing Node.js dependencies...
cd frontend
call npm install --silent
if errorlevel 1 ( echo [ERROR] npm install failed & cd .. & pause & exit /b 1 )

echo.
echo [6b]  Installing shadcn/ui components...
call npx shadcn@latest add button card input label slider tabs badge dialog ^
    tooltip popover separator scroll-area select switch progress textarea ^
    dropdown-menu ^
    --yes --silent
echo [OK] shadcn components installed

echo.
echo [7/7] Building React frontend...
call npm run build
if errorlevel 1 ( echo [ERROR] Frontend build failed & cd .. & pause & exit /b 1 )
cd ..

echo.
echo ================================================================
echo   Installation complete!
echo.
echo   BEFORE FIRST RUN:
echo   1. Edit .env and add your HF_TOKEN (required for model download)
echo   2. Accept the model license at:
echo        https://huggingface.co/ideogram-ai/ideogram-4-fp8
echo   3. Add IDEOGRAM_API_KEY for Magic Prompt (free at developer.ideogram.ai)
echo.
echo   Then run:  run.bat
echo.
echo   NOTE: First generation downloads ~13-22 GB of model weights.
echo         Subsequent runs load from cache (~20-40s warm-up).
echo ================================================================
pause
