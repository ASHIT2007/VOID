import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Configuration for the API
# By default, it connects to Groq API directly so it functions fully standalone.
# If you are running a local LLM gateway (like freellmapi), point this to http://localhost:3001/v1
API_BASE_URL = os.getenv("API_BASE_URL", "https://api.groq.com/openai/v1")
API_KEY = os.getenv("GROQ_API_KEY", "")

# Voice Assistant Configurations
ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# Model selection (using Groq's fast reasoning model)
MODEL_NAME = os.getenv("MODEL_NAME", "llama-3.3-70b-versatile")

# IDE Workspace Path
# Set this to the absolute path of your active Void IDE workspace for context reading
WORKSPACE_PATH = os.getenv("WORKSPACE_PATH", os.getcwd())
