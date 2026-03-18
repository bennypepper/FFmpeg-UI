# FFmpeg Web UI Converter 

![Python](https://img.shields.io/badge/python-3.8+-blue.svg) ![Flask](https://img.shields.io/badge/Flask-2.0+-lightgrey.svg) ![FFmpeg](https://img.shields.io/badge/FFmpeg-Ready-green.svg) ![TailwindCSS](https://img.shields.io/badge/TailwindCSS-Enabled-blue.svg)

A simple, self-hosted web interface for FFmpeg that allows you to convert audio files by dragging and dropping them directly into your browser. This project provides a user-friendly GUI to control common audio conversion settings without needing to use the command line directly.

## 📌 Project Overview
This tool bridges the gap between the powerful FFmpeg command-line utility and everyday users. It features an interactive frontend that communicates with a lightweight Python Flask backend. The server executes FFmpeg via Python's `subprocess` module, processes the audio locally for maximum privacy and speed, and returns the converted file. 

## 🛠️ Tech Stack & Tools
* **Frontend:** HTML5, JavaScript, Tailwind CSS
* **Backend:** Python, Flask, Flask-CORS
* **Audio Processing:** FFmpeg
* **Automation:** Windows Batch Scripting (`.bat`)

## 🚀 Key Features
* **Interactive UI:** Drag-and-drop functionality with real-time file upload progress bars.
* **Full Audio Control:** Granular control over target formats (MP3, WAV, AAC, FLAC, OGG, M4A), bitrates, sample rates, and audio channels.
* **Automated Environment Setup:** Includes a batch script that automatically requests admin privileges to install Chocolatey, Python, FFmpeg, and required PIP libraries.
* **Educational:** Dynamically displays the exact FFmpeg command being generated and executed under the hood.
* **Automated Cleanup:** Safely deletes temporary input and output files from the server immediately after the download is completed.

## 📂 Repository Structure
```text
ffmpeg-web-ui/
├── install_dependencies.bat  # All-in-one Windows installer for required software
├── start_converter.bat       # One-click script to launch the server and UI
├── server.py                 # The Python Flask backend that executes FFmpeg
├── index.html                # The frontend web interface
└── README.md
```

## 💻 How to Run Locally (Windows)

**1. Install Dependencies (First Time Only)**
Right-click on `install_dependencies.bat` and select **"Run as administrator"**. This script will automatically check for and install Chocolatey, Python, FFmpeg, and the required Flask libraries.

**2. Launch the Application**
Double-click `start_converter.bat`. This will automatically:
* Start the Python Flask server in a new command prompt window.
* Open the converter interface (`index.html`) in your default web browser.

**3. Convert Audio**
Drag an audio file into the browser drop-zone, configure your settings, and click "Convert". The file will process locally and download automatically.

## 📝 License
This project is licensed under the MIT License.
