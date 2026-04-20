@echo off
REM ============================================================================
REM  All-in-One FFmpeg Converter Project Installer
REM ============================================================================
REM  This script checks for and installs all necessary dependencies to run the
REM  FFmpeg Audio Converter application. This includes Chocolatey, Python,
REM  FFmpeg, and required Python libraries.
REM
REM  Instructions:
REM  1. Save this file as "install_dependencies.bat".
REM  2. Right-click the file and select "Run as administrator". This is
REM     required for installing software.
REM ============================================================================

:: BatchGotAdmin
:-------------------------------------
REM  --> Check for permissions
>nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"

REM --> If error flag set, we do not have admin.
if '%errorlevel%' NEQ '0' (
    echo.
    echo =================================================
    echo   Requesting administrative privileges...
    echo   Please accept the UAC prompt.
    echo =================================================
    goto UACPrompt
) else ( goto gotAdmin )

:UACPrompt
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    set params = %*:"="
    echo UAC.ShellExecute "cmd.exe", "/c ""%~s0"" %params%", "", "runas", 1 >> "%temp%\getadmin.vbs"

    "%temp%\getadmin.vbs"
    del "%temp%\getadmin.vbs"
    exit /B

:gotAdmin
    pushd "%CD%"
    CD /D "%~dp0"
:--------------------------------------

:: Main script starts here
cls
echo =======================================================================
echo      FFmpeg Converter - Automatic Dependency Installer
echo =======================================================================
echo.
echo This script will now check for and install the required software.
echo This requires an active internet connection.
echo.
pause

:: -----------------------------------------------------------------------
:: 1. Check for and Install Chocolatey Package Manager
:: -----------------------------------------------------------------------
echo.
echo [Step 1/4] Checking for Chocolatey package manager...
choco --version >nul 2>&1
if %errorlevel% equ 0 (
    echo Chocolatey is already installed. Skipping installation.
) else (
    echo Chocolatey not found. Installing now...
    @"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -InputFormat None -ExecutionPolicy Bypass -Command "[System.Net.ServicePointManager]::SecurityProtocol = 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))" && SET "PATH=%PATH%;%ALLUSERSPROFILE%\chocolatey\bin"
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install Chocolatey. Please try running the script again.
        goto:eof
    )
    echo Chocolatey installed successfully.
)

:: -----------------------------------------------------------------------
:: 2. Check for and Install Python 3
:: -----------------------------------------------------------------------
echo.
echo [Step 2/4] Checking for Python 3...
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo Python is already installed. Skipping installation.
) else (
    echo Python not found. Installing using Chocolatey...
    choco install python -y --force
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install Python. Please check your internet connection.
        goto:eof
    )
    echo Python installed successfully.
)

:: -----------------------------------------------------------------------
:: 3. Check for and Install FFmpeg
:: -----------------------------------------------------------------------
echo.
echo [Step 3/4] Checking for FFmpeg...
ffmpeg -version >nul 2>&1
if %errorlevel% equ 0 (
    echo FFmpeg is already installed. Skipping installation.
) else (
    echo FFmpeg not found. Installing using Chocolatey...
    choco install ffmpeg -y --force
    if %errorlevel% neq 0 (
        echo ERROR: Failed to install FFmpeg. Please check your internet connection.
        goto:eof
    )
    echo FFmpeg installed successfully.
)

:: -----------------------------------------------------------------------
:: 4. Install Python Libraries (Flask & Flask-CORS)
:: -----------------------------------------------------------------------
echo.
echo [Step 4/4] Installing required Python libraries (Flask and Flask-CORS)...
pip install Flask Flask-CORS
if %errorlevel% neq 0 (
    echo ERROR: Failed to install Python libraries.
    goto:eof
)
echo Python libraries installed successfully.

:: -----------------------------------------------------------------------
:: Finalization
:: -----------------------------------------------------------------------
echo.
echo =======================================================================
echo   Installation Complete! All dependencies are now installed.
echo =======================================================================
echo.
echo You can now run the application using the 'start_converter.bat' file.
echo.
pause
exit
