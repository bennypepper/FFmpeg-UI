#!/bin/bash
# ============================================================================
#  All-in-One FFmpeg Web UI Project Installer (macOS & Linux)
# ============================================================================

echo "======================================================================="
echo "     FFmpeg Web UI - Automatic Dependency Installer"
echo "======================================================================="
echo ""
echo "This script will check for and install the required software."
echo "You may be prompted for your password to install packages via sudo."
echo ""
read -p "Press [Enter] to continue..."

OS="$(uname -s)"

# 1. Update package lists
echo ""
echo "[Step 1/3] Updating package managers..."
if [ "$OS" = "Darwin" ]; then
    if ! command -v brew &> /dev/null; then
        echo "Homebrew not found. Installing Homebrew..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    else
        brew update
    fi
elif [ -x "$(command -v apt-get)" ]; then
    sudo apt-get update
elif [ -x "$(command -v dnf)" ]; then
    sudo dnf check-update
elif [ -x "$(command -v pacman)" ]; then
    sudo pacman -Sy
fi

# 2. Check for and Install Python & FFmpeg
echo ""
echo "[Step 2/3] Installing Python 3 and FFmpeg..."
if [ "$OS" = "Darwin" ]; then
    brew install python ffmpeg
elif [ -x "$(command -v apt-get)" ]; then
    sudo apt-get install -y python3 python3-pip ffmpeg
elif [ -x "$(command -v dnf)" ]; then
    sudo dnf install -y python3 python3-pip ffmpeg
elif [ -x "$(command -v pacman)" ]; then
    sudo pacman -S --noconfirm python python-pip ffmpeg
fi

# 3. Install Python Libraries (Flask & Flask-CORS)
echo ""
echo "[Step 3/3] Installing required Python libraries (Flask and Flask-CORS)..."
if command -v pip3 &> /dev/null; then
    pip3 install Flask Flask-CORS --break-system-packages 2>/dev/null || pip3 install Flask Flask-CORS
else
    pip install Flask Flask-CORS --break-system-packages 2>/dev/null || pip install Flask Flask-CORS
fi

echo ""
echo "======================================================================="
echo "  Installation Complete! All dependencies are now installed."
echo "======================================================================="
echo ""
echo "You can now start the application by running: bash start_converter.sh"
echo ""
