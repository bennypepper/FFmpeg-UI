@echo off
title FFmpeg Web UI
echo.
echo  ===================================
echo   FFmpeg Web UI — Starting server
echo  ===================================
echo.

:: Check Python
where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Run install_dependencies.bat first.
    pause & exit /b 1
)

:: Check Flask
python -c "import flask" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing Python dependencies...
    pip install flask flask-cors
)

:: Create folders if missing
if not exist "uploads"  mkdir uploads
if not exist "outputs"  mkdir outputs
if not exist "static\js" mkdir static\js
if not exist "static\css" mkdir static\css

echo  Starting Flask server on http://127.0.0.1:5000
echo  Press Ctrl+C in this window to stop.
echo.

:: Open browser after short delay (1.5 sec)
start "" /min cmd /c "timeout /t 2 >nul && start http://127.0.0.1:5000"

:: Run server
python server.py

pause
