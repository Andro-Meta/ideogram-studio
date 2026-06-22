@echo off
setlocal
rem One-time install of Boogu-Image-0.1-Edit (separate 10B native edit model, ~20 GB).
rem Clones the repo, builds its own venv (pinned torch 2.7/cu126), downloads the Edit weights.
set DIR=%~dp0Boogu-Image

where git >nul 2>&1 || (echo git not found & exit /b 1)

if not exist "%DIR%" (
  echo Cloning Boogu-Image...
  git clone https://github.com/boogu-project/Boogu-Image "%DIR%" || goto :err
)
cd /d "%DIR%" || goto :err

if not exist venv (
  echo Creating venv...
  python -m venv venv || goto :err
)
call venv\Scripts\activate.bat || goto :err

echo Installing deps (this is large)...
pip install -r requirements/torch2.7-cu126.txt || goto :err
pip install -e . || goto :err

echo Downloading Edit weights (~20 GB)...
pip install -U "huggingface_hub[cli]" >nul 2>&1
huggingface-cli download Boogu/Boogu-Image-0.1-Edit --local-dir models\Boogu-Image-0.1-Edit || goto :err

echo.
echo Boogu Edit installed. Open the Boogu tab in the app.
goto :eof

:err
echo.
echo SETUP FAILED — see the error above.
exit /b 1
