@echo off
setlocal enabledelayedexpansion
title Ideogram Studio - Optional PiD upscaler setup
echo.
echo ================================================================
echo   Optional: NVIDIA PiD prompt-aware upscaler
echo ================================================================
echo.
echo   PiD re-synthesizes detail from your prompt for a 2x upscale.
echo   It is HEAVY: it needs ~14 GB of FREE RAM to run (on top of the
echo   model). On a 24 GB GPU / 32 GB RAM machine it is a tight squeeze
echo   - the studio guards it so it refuses to run (rather than crash)
echo   when RAM is low. Recommended for 64 GB+ machines.
echo.
echo   This downloads ~8 GB (PiD checkpoint + Flux.2 VAE + Gemma-2-2b-it)
echo   and requires you to accept the Gemma license once:
echo       https://huggingface.co/google/gemma-2-2b-it
echo.
echo   License: PiD is NSCLv1 (non-commercial), like Ideogram's weights.
echo.
set /p _GO=  Continue? (y/N):
if /i not "!_GO!"=="y" ( echo Cancelled. & pause & exit /b 0 )

if not exist venv\Scripts\python.exe ( echo [ERROR] Run install.bat first. & pause & exit /b 1 )

:: 1. Clone NVIDIA's PiD repo
if not exist models\pid_repo\pid (
    echo [1/4] Cloning nv-tlabs/PiD ...
    git clone --depth 1 https://github.com/nv-tlabs/PiD.git models\pid_repo >> install.log 2>&1
    if errorlevel 1 ( echo [ERROR] git clone failed - is git installed? & pause & exit /b 1 )
) else ( echo [1/4] PiD repo already present. )

:: 2. Install PiD's deps + the package into the existing venv (no core ML bumps)
echo [2/4] Installing PiD dependencies ...
venv\Scripts\python.exe -m pip install hydra-core omegaconf loguru termcolor fvcore iopath attrs pyyaml wandb boto3 pandas imageio >> install.log 2>&1
venv\Scripts\python.exe -m pip install -e models\pid_repo --no-deps >> install.log 2>&1
if errorlevel 1 ( echo [ERROR] pip install failed - see install.log & pause & exit /b 1 )

:: 3. Download the flux2 *2k* checkpoint + VAE + Gemma (uses HF_TOKEN from .env)
echo [3/4] Downloading PiD flux2 2k checkpoint + VAE + Gemma-2-2b-it (~8 GB) ...
venv\Scripts\python.exe -c "import os; tok=[l.strip().split('=',1)[1] for l in open('.env',encoding='utf-8') if l.startswith('HF_TOKEN=')][0] if os.path.exists('.env') else None; from huggingface_hub import snapshot_download as d; d('nvidia/PiD', local_dir='models/pid_repo', token=tok, allow_patterns=['checkpoints/PiD_res2k_sr4x_official_flux2_distill_4step/*','checkpoints/flux2_ae.safetensors']); d('google/gemma-2-2b-it', token=tok, allow_patterns=['*.safetensors','*.json','*.model','tokenizer*']); print('downloads OK')" >> install.log 2>&1
if errorlevel 1 ( echo [ERROR] download failed - did you accept the Gemma license + set HF_TOKEN? See install.log & pause & exit /b 1 )

:: 4. Verify
echo [4/4] Verifying ...
venv\Scripts\python.exe -c "import sys; sys.path.insert(0,'backend'); import pid_upscale; ok,why=pid_upscale.availability(); print('PiD available:' , ok, '' if ok else '('+why+')')"
echo.
echo [DONE] If it says "PiD available: True", restart the studio (run.bat).
echo        The "2x PiD (NVIDIA, prompt-aware)" option will appear in the
echo        Upscale picker. It only runs when ~14 GB RAM is free.
echo.
pause
