# Jarvis Voice Assistant Architecture

## Overview
Jarvis is a Push-to-Talk voice assistant tailored for Windows 11. To eliminate local VRAM usage and maximize performance on standard hardware, the system is designed to use a 100% cloud-based inference pipeline. All models (STT, LLM, TTS) are hosted externally or locally proxied without utilizing the machine's GPU.

## Component Flow

```mermaid
flowchart TD
    User([User]) -- Press Hotkey --> AudioAgent[Audio Agent]
    AudioAgent -- Capture Mic --> AudioBuffer[(Audio Buffer)]
    User -- Release Hotkey --> AudioAgent
    AudioAgent -- Send Audio File --> STTAgent[STT Agent (Groq Whisper API)]
    STTAgent -- Return Transcript --> Orchestrator[Orchestrator]
    Orchestrator -- Context + Transcript --> MemoryAgent[Memory Agent]
    MemoryAgent -- Updated Conversation --> LLMAgent[LLM Agent (FreeLLMAPI Proxy)]
    LLMAgent -- Return Text Response --> Orchestrator
    Orchestrator -- Text --> TTSAgent[TTS Agent (Cloud TTS API)]
    TTSAgent -- Return Audio Stream --> AudioAgent
    AudioAgent -- Playback --> Speakers([Speakers])
```

## System Requirements
- **OS**: Windows 11
- **RAM**: Minimal (handles basic audio buffers and Python runtime)
- **GPU**: N/A (0 VRAM required)
- **Network**: Stable internet connection required for API calls

## Component Details

### 1. Audio Agent
- **Libraries**: `pynput` (hotkey detection), `sounddevice` (audio I/O), `soundfile` (WAV export).
- **Function**: Detects the Push-to-Talk hotkey asynchronously. Captures audio while the key is pressed and exports it to a temporary WAV file required by Cloud STT APIs. Handles playback of synthesized speech.

### 2. STT Agent (Groq Whisper API)
- **Library**: `groq`
- **Configuration**: Targets the `whisper-large-v3-turbo` model for ultra-low latency transcription.
- **Function**: Sends the raw audio to the Groq cloud and returns text.

### 3. Memory Agent
- **Function**: Maintains the state of the conversation locally in system RAM. Enforces context length limits by trimming older messages if necessary, while preserving the system prompt.

### 4. LLM Agent (FreeLLMAPI Proxy)
- **Libraries**: `openai` (Python SDK).
- **Configuration**: Connects to `http://localhost:8000/v1` (or your proxy address).
- **Function**: Leverages your local FreeLLMAPI proxy to route requests securely to free-tier cloud models.

### 5. TTS Agent (Cloud TTS API)
- **Libraries**: `requests` or provider-specific SDKs.
- **Configuration**: Connects to ElevenLabs, OpenAI TTS, or Hugging Face XTTS API based on configuration.
- **Function**: Converts the LLM's text response back into speech. Can utilize streaming to reduce perceived latency.

## Logging & Latency
Structured logging will capture timings at each network boundary to output:
- API Request Latency (STT)
- API Request Latency (LLM Time-to-First-Token)
- API Request Latency (TTS)
- Total End-to-End Latency
