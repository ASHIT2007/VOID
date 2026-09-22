import tempfile
from typing import Optional
from elevenlabs.client import ElevenLabs
from config import ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID

class TTSAgent:
    def __init__(self):
        self.client = ElevenLabs(api_key=ELEVENLABS_API_KEY) if ELEVENLABS_API_KEY else None
        # Default Rachel voice if no custom ID is provided
        self.voice_id = ELEVENLABS_VOICE_ID if ELEVENLABS_VOICE_ID else "21m00Tcm4TlvDq8ikWAM" 

    def synthesize(self, text: str) -> Optional[str]:
        """Synthesizes text to speech using ElevenLabs and returns the temp file path."""
        if not self.client:
            print("[TTSAgent Error] ELEVENLABS_API_KEY is not set.")
            return None
        
        # Clean text of markdown or JSON structures for a better reading experience
        clean_text = self._clean_text(text)
        if not clean_text:
            return None

        try:
            audio = self.client.text_to_speech.convert(
                text=clean_text,
                voice_id=self.voice_id,
                model_id="eleven_multilingual_v2"
            )
            temp_file = tempfile.NamedTemporaryFile(suffix=".mp3", delete=False)
            for chunk in audio:
                if chunk:
                    temp_file.write(chunk)
            temp_file.close()
            return temp_file.name
        except Exception as e:
            print(f"[TTSAgent Error] {e}")
            return None

    def _clean_text(self, text: str) -> str:
        """Removes code blocks and markdown to make it readable."""
        import re
        # Remove code blocks
        text = re.sub(r'```.*?```', ' I have written the code block in the terminal. ', text, flags=re.DOTALL)
        # Remove tool calls if any leaked
        text = re.sub(r'<function/.*?>\{.*?\}', '', text, flags=re.DOTALL)
        # Remove markdown bold/italics
        text = text.replace('**', '').replace('*', '')
        return text.strip()
