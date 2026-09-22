import os
from typing import Optional
from groq import Groq
from config import GROQ_API_KEY

class STTAgent:
    def __init__(self):
        # We handle the case where GROQ_API_KEY is empty in the UI
        self.client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

    def transcribe(self, audio_file_path: str) -> Optional[str]:
        """Transcribes an audio file using Groq's Whisper API."""
        if not self.client:
            print("[STTAgent Error] GROQ_API_KEY is not set.")
            return None

        try:
            with open(audio_file_path, "rb") as file:
                transcription = self.client.audio.transcriptions.create(
                  file=(os.path.basename(audio_file_path), file.read()),
                  model="whisper-large-v3-turbo",
                  response_format="json",
                  language="en",
                  temperature=0.0
                )
                return transcription.text
        except Exception as e:
            print(f"[STTAgent Error] {e}")
            return None
