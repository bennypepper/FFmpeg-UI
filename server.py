import os
import subprocess
from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
import uuid

# --- Basic Flask App Setup ---
app = Flask(__name__)
# It's crucial to enable CORS to allow the front-end (on a different "origin") 
# to communicate with this server.
CORS(app)

# --- Configuration ---
# Create directories to store uploaded and converted files.
# It's good practice to separate them.
UPLOAD_FOLDER = 'uploads'
CONVERTED_FOLDER = 'converted'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(CONVERTED_FOLDER, exist_ok=True)

# --- Helper Function ---
def cleanup_files(files_to_delete):
    """A helper function to delete temporary files after processing."""
    for f in files_to_delete:
        try:
            if os.path.exists(f):
                os.remove(f)
                print(f"Successfully deleted temporary file: {f}")
        except Exception as e:
            print(f"Error deleting file {f}: {e}")

# --- The Main Conversion Route ---
@app.route('/convert', methods=['POST'])
def convert_audio():
    """
    This endpoint handles the file upload and FFmpeg conversion.
    It receives the audio file and conversion settings from the front-end.
    """
    # 1. --- Validate the Request ---
    if 'file' not in request.files:
        return jsonify({"error": "No file part in the request"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    # 2. --- Get Conversion Settings from the Form Data ---
    # These are sent along with the file from our JavaScript.
    target_format = request.form.get('format', 'mp3')
    bitrate = request.form.get('bitrate', '128')
    channels = request.form.get('channels', '2')
    sample_rate = request.form.get('sampleRate', '44100')

    # 3. --- Save the Uploaded File Securely ---
    # Generate a unique filename to avoid conflicts and for security.
    unique_id = str(uuid.uuid4())
    original_extension = os.path.splitext(file.filename)[1]
    input_filename = f"{unique_id}{original_extension}"
    output_filename = f"{unique_id}.{target_format}"
    
    input_filepath = os.path.join(UPLOAD_FOLDER, input_filename)
    output_filepath = os.path.join(CONVERTED_FOLDER, output_filename)
    
    file.save(input_filepath)
    print(f"File saved to: {input_filepath}")

    # 4. --- Construct and Execute the FFmpeg Command ---
    try:
        # This is where Python tells the operating system to run FFmpeg.
        # We build the command as a list of arguments for security and clarity.
        command = [
            'ffmpeg',
            '-i', input_filepath, # Input file
            '-vn', # No video output
            '-ac', channels, # Audio channels
            '-ar', sample_rate, # Audio sample rate
            '-b:a', f'{bitrate}k', # Audio bitrate
            output_filepath # Output file
        ]
        
        print(f"Executing FFmpeg command: {' '.join(command)}")

        # The `subprocess.run` command executes the command and waits for it to complete.
        # `check=True` will raise an exception if FFmpeg returns an error.
        # `capture_output=True` and `text=True` capture the command's stdout and stderr.
        result = subprocess.run(
            command, 
            check=True, 
            capture_output=True, 
            text=True
        )
        
        print("FFmpeg stdout:", result.stdout)
        print("FFmpeg stderr:", result.stderr)
        print(f"Conversion successful. Output at: {output_filepath}")

        # 5. --- Send the Converted File Back to the User ---
        # `send_file` is a Flask helper that streams the file back.
        # `as_attachment=True` tells the browser to prompt a download.
        response = send_file(
            output_filepath, 
            as_attachment=True,
            mimetype=f'audio/{target_format}'
        )
        
        # Schedule files for cleanup after the request is finished.
        @response.call_on_close
        def after_request_cleanup():
            cleanup_files([input_filepath, output_filepath])

        return response

    except subprocess.CalledProcessError as e:
        # This block runs if FFmpeg fails.
        print(f"FFmpeg error occurred: {e}")
        print("FFmpeg stderr:", e.stderr)
        # Clean up the failed input file.
        cleanup_files([input_filepath])
        return jsonify({
            "error": "FFmpeg conversion failed.",
            "details": e.stderr
        }), 500
    except Exception as e:
        # General error handling.
        print(f"An unexpected error occurred: {e}")
        cleanup_files([input_filepath])
        return jsonify({"error": "An unexpected server error occurred."}), 500

# --- How to Run This Server ---
if __name__ == '__main__':
    # Runs the Flask app. `debug=True` allows for auto-reloading on code changes.
    # The server will be accessible at http://127.0.0.1:5000
    app.run(debug=True, port=5000)

