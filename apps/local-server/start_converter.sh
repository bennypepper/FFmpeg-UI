#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo ""
echo " ==================================="
echo "  FFmpeg UI - Starting local server"
echo " ==================================="
echo ""

# Prefer local .venv, fallback to python3
if [ -x ".venv/bin/python" ]; then
    PY_CMD=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PY_CMD="python3"
else
    echo "[ERROR] Python 3 not found. Run: bash install_dependencies.sh"
    exit 1
fi

# Check both flask and flask_cors
if ! "$PY_CMD" -c "import flask, flask_cors" >/dev/null 2>&1; then
    echo "[INFO] Flask dependencies missing; setting up .venv from requirements.txt..."
    if [ ! -x ".venv/bin/python" ]; then
        python3 -m venv .venv
    fi
    PY_CMD=".venv/bin/python"
    "$PY_CMD" -m pip install -r requirements.txt
fi

# Check built web frontend
if [ ! -f "../local-server-web/dist/index.html" ]; then
    echo "[WARNING] Frontend build not found at ../local-server-web/dist/index.html"
    echo "[HINT]    Run 'npm run build' from the repository root first."
    echo ""
fi

mkdir -p uploads outputs

echo " Starting Flask server on http://127.0.0.1:5000"
echo " Press Ctrl+C in this window to stop."
echo ""

if command -v xdg-open >/dev/null 2>&1; then
    (sleep 2 && xdg-open "http://127.0.0.1:5000") &
elif command -v open >/dev/null 2>&1; then
    (sleep 2 && open "http://127.0.0.1:5000") &
fi

exec "$PY_CMD" server.py
