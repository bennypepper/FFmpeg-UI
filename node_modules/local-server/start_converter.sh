#!/bin/bash
echo ""
echo " ==================================="
echo "  FFmpeg Web UI — Starting server"
echo " ==================================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "[ERROR] Python 3 not found. Run bash install_dependencies.sh first."
    exit 1
fi

# Check Flask
if ! python3 -c "import flask" &> /dev/null; then
    echo "[INFO] Installing Python dependencies..."
    if command -v pip3 &> /dev/null; then
        pip3 install flask flask-cors --break-system-packages 2>/dev/null || pip3 install flask flask-cors
    else
        pip install flask flask-cors --break-system-packages 2>/dev/null || pip install flask flask-cors
    fi
fi

# Create folders if missing
mkdir -p uploads outputs static/js static/css

echo " Starting Flask server on http://127.0.0.1:5000"
echo " Press Ctrl+C in this window to stop."
echo ""

# Open browser based on OS
if which xdg-open > /dev/null; then
    (sleep 2 && xdg-open "http://127.0.0.1:5000") &
elif which open > /dev/null; then
    (sleep 2 && open "http://127.0.0.1:5000") &
fi

# Run server
python3 server.py
