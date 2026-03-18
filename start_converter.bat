@echo off
REM ============================================================================
REM  FFmpeg Audio Converter Launcher
REM ============================================================================
REM  This script automates the process of starting the Python server and
REM  opening the web interface for the FFmpeg Audio Converter application.
REM
REM  Instructions:
REM  1. Save this file as "start_converter.bat" in the SAME directory as
REM     your 'server.py' and 'index.html' files.
REM  2. Make sure you have Python and FFmpeg installed and accessible in your
REM     system's PATH.
REM  3. Double-click this "start_converter.bat" file to run the application.
REM ============================================================================

ECHO.
ECHO Starting the FFmpeg Converter application...
ECHO.

REM --- Step 1: Start the Python Flask Server ---
REM We use "start" to launch the server in a new, separate command window.
REM This allows the script to continue to the next step without waiting for
REM the server to be manually closed.
ECHO Launching the Python server in a new window...
start "FFmpeg Python Server" cmd /k "python server.py"

REM Give the server a moment to initialize before opening the browser.
ECHO Waiting for the server to start...
timeout /t 3 /nobreak > nul

REM --- Step 2: Open the HTML interface in the default browser ---
ECHO Opening the converter interface in your default browser...
start "" "index.html"

ECHO.
ECHO Application is running. You can now use the converter in your browser.
ECHO The Python server is running in a separate window. Close that window to stop the server.
ECHO.

REM This command window will close automatically after a few seconds.
timeout /t 5 > nul
exit
