#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "======================================================================="
echo "     FFmpeg UI Local Server - Dependency Setup (macOS / Linux)"
echo "======================================================================="
echo ""

# 1. Check Python 3
if ! command -v python3 >/dev/null 2>&1; then
    echo "[ERROR] python3 was not found on PATH."
    echo "Install Python 3.11+ using your system package manager:"
    echo "  macOS : brew install python"
    echo "  Debian: sudo apt-get install -y python3 python3-venv"
    echo "  Fedora: sudo dnf install -y python3"
    exit 1
fi
echo "[Step 1/3] Found $(python3 --version)"

# 2. Check FFmpeg / FFprobe
echo ""
echo "[Step 2/3] Checking FFmpeg and FFprobe..."
if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "[WARNING] ffmpeg was not found on PATH."
    echo "Install FFmpeg using your system package manager:"
    echo "  macOS : brew install ffmpeg"
    echo "  Debian: sudo apt-get install -y ffmpeg"
    echo "  Fedora: sudo dnf install -y ffmpeg"
else
    echo "Found $(ffmpeg -version | head -n 1)"
fi

if ! command -v ffprobe >/dev/null 2>&1; then
    echo "[WARNING] ffprobe was not found on PATH."
fi

# 3. Create venv and install pinned dependencies from requirements.txt
echo ""
echo "[Step 3/3] Creating virtual environment (.venv) and installing requirements..."
if [ ! -x ".venv/bin/python" ]; then
    python3 -m venv .venv
fi

.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt

echo ""
echo "======================================================================="
echo "  Setup Complete!"
echo "  Start the server with: bash start_converter.sh"
echo "  Note: Build the web UI first from repo root with: npm run build"
echo "======================================================================="
