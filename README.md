# FFmpeg Web UI Converter 

![Python](https://img.shields.io/badge/python-3.8+-blue.svg) ![Flask](https://img.shields.io/badge/Flask-2.0+-lightgrey.svg) ![FFmpeg](https://img.shields.io/badge/FFmpeg-Ready-green.svg) ![TailwindCSS](https://img.shields.io/badge/TailwindCSS-Enabled-blue.svg)

A simple, self-hosted web interface for FFmpeg that allows you to convert audio files by dragging and dropping them directly into your browser[cite: 9]. This project provides a user-friendly GUI to control common audio conversion settings without needing to use the command line directly[cite: 9].

## 📌 Project Overview
This tool bridges the gap between the powerful FFmpeg command-line utility and everyday users. It features an interactive frontend that communicates with a lightweight Python Flask backend[cite: 9]. The server executes FFmpeg via Python's `subprocess` module, processes the audio locally for maximum privacy and speed, and returns the converted file[cite: 9, 10]. 

## 🛠️ Tech Stack & Tools
* **Frontend:** HTML5, JavaScript, Tailwind CSS[cite: 7]
* **Backend:** Python, Flask, Flask-CORS[cite: 6, 10]
* **Audio Processing:** FFmpeg[cite: 6, 10]
* **Automation:** Windows Batch Scripting (`.bat`)[cite: 6, 8]

## 🚀 Key Features
* **Interactive UI:** Drag-and-drop functionality with real-time file upload progress bars[cite: 7, 9].
* **Full Audio Control:** Granular control over target formats (MP3, WAV, AAC, FLAC, OGG, M4A), bitrates, sample rates, and audio channels[cite: 7, 9].
* **Automated Environment Setup:** Includes a batch script that automatically requests admin privileges to install Chocolatey, Python, FFmpeg, and required PIP libraries[cite: 6, 9].
* **Educational:** Dynamically displays the exact FFmpeg command being generated and executed under the hood[cite: 7, 9].
* **Automated Cleanup:** Safely deletes temporary input and output files from the server immediately after the download is completed.

## 📂 Repository Structure
```text
ffmpeg-web-ui/
├── install_dependencies.bat  # All-in-one Windows installer for required software[cite: 6]
├── start_converter.bat       # One-click script to launch the server and UI[cite: 8]
├── server.py                 # The Python Flask backend that executes FFmpeg[cite: 9, 10]
├── index.html                # The frontend web interface[cite: 7, 9]
└── README.md
```

## 💻 How to Run Locally (Windows)

**1. Install Dependencies (First Time Only)**
Right-click on `install_dependencies.bat` and select **"Run as administrator"**[cite: 6]. This script will automatically check for and install Chocolatey, Python, FFmpeg, and the required Flask libraries[cite: 6].

**2. Launch the Application**
Double-click `start_converter.bat`[cite: 8]. This will automatically:
* Start the Python Flask server in a new command prompt window[cite: 8].
* Open the converter interface (`index.html`) in your default web browser[cite: 8].

**3. Convert Audio**
Drag an audio file into the browser drop-zone, configure your settings, and click "Convert"[cite: 7, 9]. The file will process locally and download automatically.

## 📝 License
This project is licensed under the MIT License.
