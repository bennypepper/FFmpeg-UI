@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo =======================================================================
echo      FFmpeg UI Local Server - Dependency Setup (Windows)
echo =======================================================================
echo.

:: 1. Locate Python 3
set "PY_CMD="
py -3 --version >nul 2>&1
if not errorlevel 1 (
    set "PY_CMD=py -3"
) else (
    python --version >nul 2>&1
    if not errorlevel 1 (
        set "PY_CMD=python"
    )
)

if "%PY_CMD%"=="" (
    echo [ERROR] Python 3 was not found on PATH.
    echo Please install Python 3.11+ from https://www.python.org/downloads/
    echo or run: winget install -e --id Python.Python.3.12
    echo.
    pause
    exit /b 1
)

echo [Step 1/3] Using Python:
%PY_CMD% --version

:: 2. Verify FFmpeg & FFprobe
echo.
echo [Step 2/3] Checking FFmpeg and FFprobe...
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo [WARNING] FFmpeg was not found on PATH.
    echo Install FFmpeg via winget: winget install -e --id Gyan.FFmpeg
    echo or download from https://www.gyan.dev/ffmpeg/builds/
    echo Continuing Python dependency setup...
) else (
    echo FFmpeg found.
)

ffprobe -version >nul 2>&1
if errorlevel 1 (
    echo [WARNING] FFprobe was not found on PATH. Media inspection requires ffprobe.
)

:: 3. Create local virtual environment and install requirements.txt
echo.
echo [Step 3/3] Setting up virtual environment and installing requirements...
if not exist ".venv\Scripts\python.exe" (
    %PY_CMD% -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment .venv.
        pause
        exit /b 1
    )
)

".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 (
    echo [WARNING] Could not upgrade pip; continuing with installed pip.
)

".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install Python dependencies from requirements.txt.
    pause
    exit /b 1
)

echo.
echo =======================================================================
echo   Setup Complete!
echo   Start the server with: start_converter.bat
echo   Note: Build the web UI first from repo root with: npm run build
echo =======================================================================
echo.
pause
exit /b 0
