@echo off
setlocal
cd /d "%~dp0"

title FFmpeg UI - Local Server
echo.
echo  ===================================
echo   FFmpeg UI - Starting local server
echo  ===================================
echo.

:: Locate Python (prefer local .venv, then py -3, then python)
set "PY_CMD="
if exist ".venv\Scripts\python.exe" (
    set "PY_CMD=.venv\Scripts\python.exe"
) else (
    py -3 --version >nul 2>&1
    if not errorlevel 1 (
        set "PY_CMD=py -3"
    ) else (
        python --version >nul 2>&1
        if not errorlevel 1 (
            set "PY_CMD=python"
        )
    )
)

if "%PY_CMD%"=="" (
    echo [ERROR] Python 3 not found. Run install_dependencies.bat first.
    pause
    exit /b 1
)

:: Check both flask and flask_cors
%PY_CMD% -c "import flask, flask_cors" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing Python dependencies from requirements.txt...
    %PY_CMD% -m pip install -r requirements.txt
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies. Run install_dependencies.bat first.
        pause
        exit /b 1
    )
)

:: Check built web frontend
if not exist "..\local-server-web\dist\index.html" (
    echo [WARNING] Frontend build not found at ..\local-server-web\dist\index.html
    echo [HINT]    Run "npm run build" from the repository root first.
    echo.
)

:: Create runtime folders if missing
if not exist "uploads" mkdir uploads
if not exist "outputs" mkdir outputs

echo  Starting Flask server on http://127.0.0.1:5000
echo  Press Ctrl+C in this window to stop.
echo.

start "" /min cmd /c "timeout /t 2 >nul && start http://127.0.0.1:5000"

%PY_CMD% server.py
if errorlevel 1 (
    echo.
    echo [ERROR] Server exited with error code %errorlevel%.
    pause
    exit /b %errorlevel%
)
