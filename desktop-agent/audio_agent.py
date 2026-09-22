import sounddevice as sd
import soundfile as sf
import numpy as np
import tempfile
from typing import Optional

class AudioAgent:
    def __init__(self, samplerate: int = 16000, channels: int = 1):
        self.samplerate = samplerate
        self.channels = channels
        self.recording = False
        self.audio_data = []

    def start_recording(self) -> None:
        """Starts capturing audio from the microphone."""
        self.recording = True
        self.audio_data = []
        
        def callback(indata: np.ndarray, frames: int, time, status) -> None:
            if self.recording:
                self.audio_data.append(indata.copy())
        
        self.stream = sd.InputStream(samplerate=self.samplerate, channels=self.channels, callback=callback)
        self.stream.start()

    def stop_recording(self) -> Optional[str]:
        """Stops recording and saves the buffer to a temporary WAV file."""
        self.recording = False
        if hasattr(self, 'stream'):
            self.stream.stop()
            self.stream.close()
        
        if not self.audio_data:
            return None
        
        audio_array = np.concatenate(self.audio_data, axis=0)
        temp_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        sf.write(temp_file.name, audio_array, self.samplerate)
        return temp_file.name

    def play_audio(self, file_path: str) -> None:
        """Plays an audio file synchronously using sounddevice."""
        try:
            data, fs = sf.read(file_path)
            sd.play(data, fs)
            sd.wait()
        except Exception as e:
            print(f"[AudioAgent Error] Could not play audio: {e}")

    def stop_playback(self) -> None:
        """Stops audio playback."""
        sd.stop()
