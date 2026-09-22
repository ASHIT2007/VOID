# VOID-X Desktop Agent

This is a **standalone, local-only Python desktop agent**. It is intentionally decoupled from the public web server because it has permissions to execute terminal commands, read/write files, and read system information.

**Security Warning:**
Never expose this agent or its APIs to the public internet. It executes shell commands (`run_terminal_command`) and reads local files. It is designed to be a personal, terminal-based assistant that runs directly on your machine.

## Getting Started

1. Create a `.env` file in this directory based on the `.env.example` (or just set the environment variables):
   ```
   GROQ_API_KEY="your_groq_api_key_here"
   # Optional
   ELEVENLABS_API_KEY="your_elevenlabs_api_key_here"
   ```

2. Install the required Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run the agent:
   ```bash
   python main.py
   ```

## Configuration

By default, VOID-X connects directly to the Groq API (`https://api.groq.com/openai/v1`) so it works completely out of the box without needing to run the `backend/server` API gateway.

If you *want* it to connect to your local `freellmapi` backend gateway for key-pooling and rate-limiting, simply set the following in your `.env`:
```
API_BASE_URL="http://localhost:3001/v1"
```

## Features

- **System Management**: Read CPU, RAM, Disk usage.
- **File Exploration**: Search, read, and write local files.
- **Terminal Execution**: Executes local powershell/CMD commands (always prompts for confirmation).
- **Web Browsing**: Reads URLs and searches the web using DuckDuckGo.
- **Voice Mode**: Connects to ElevenLabs and Groq Whisper.
