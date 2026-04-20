# FFmpeg Web UI Converter 

![Python](https://img.shields.io/badge/python-3.8+-blue.svg) ![Flask](https://img.shields.io/badge/Flask-2.0+-lightgrey.svg) ![FFmpeg](https://img.shields.io/badge/FFmpeg-Ready-green.svg) ![LocalFirst](https://img.shields.io/badge/LocalFirst-Enabled-blue.svg)

A minimalist, self-hosted web interface for FFmpeg that allows you to manage advanced video and audio encoding completely offline. Process your multimedia files securely in your local browser without ever uploading anything to a cloud server. 

## 📌 Project Overview
This tool bridges the gap between the powerful FFmpeg command-line utility and everyday users. It features an ultra-clean frontend that communicates with a lightweight Python Flask backend. The server executes FFmpeg locally via Python's `subprocess` module to process your files securely, rapidly, and privately.

## 🛠️ Tech Stack & Tools
* **Frontend:** Vanilla JavaScript, CSS Glassmorphism, Inline SVGs (No external dependencies)
* **Backend:** Python, Flask, Server-Sent Events (SSE)
* **Media Engine:** FFmpeg & FFprobe
* **Automation:** Cross-platform scripts (`.bat` and `.sh`)

## 🚀 Key Features
* **Dual Processing Modes:** A master toggle provides a bespoke, uncluttered interface for either Video encoding or purely Audio conversion.
* **Batch Processing Queue:** Drag-and-drop multiple files to build a robust rendering queue with drag-to-reorder prioritization and batch ZIP downloading.
* **Advanced Video Tooling:** Hardware-accelerated (NVENC/QSV) video encoding, smart remuxing, target-size bitrate targeting, and automated watermark integrations.
* **Visual Add-ons:** Dedicated tools to extract high-quality Thumbnails or Merge multiple video files natively.
* **Real-time Diagnostics:** Monitor detailed, live encoding metrics (FPS, ETA, Size) via reliable Server-Sent Events (SSE) tracking real FFmpeg output.
* **Cross-Platform Installer:** Out-of-the-box automated configuration scripts for Windows, macOS, and Linux users.

## 📂 Repository Structure
```text
ffmpeg-web-ui/
├── install_dependencies.*    # Cross-platform installers (Chocolatey/Homebrew/Apt)
├── start_converter.*         # One-click script to launch the server and UI 
├── server.py                 # The Python Flask backend that connects to FFmpeg
├── static/                   # Modularized vanilla JS scripts and modern CSS
├── index.html                # The minimalist, robust frontend application
└── README.md
```

## 💻 How to Run Locally

### Windows
1. Right-click `install_dependencies.bat` and select **"Run as administrator"**. This installs Python, FFmpeg, and Flask via Chocolatey automatically.
2. Double-click `start_converter.bat` to launch the server. Your web browser will automatically open the UI.

### macOS & Linux
1. Open up your terminal in this directory.
2. Run `bash install_dependencies.sh`. This automatically queries your OS package manager (`brew`, `apt`, `dnf`, or `pacman`) to install Python and FFmpeg.
3. Launch the environment by running `bash start_converter.sh`. 

## 📝 License
This project is licensed under the MIT License.
