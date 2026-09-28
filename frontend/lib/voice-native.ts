import type { VoiceConfig } from './voice-config';
import type { VoiceVisualState } from '@/components/VoidVisualizer';
export type NativeSession = { config: VoiceConfig; token: string; liveConfig?: Record<string, unknown> };
export type NativeVoiceHandle = { stop: () => void; interrupt: () => void; getOutputVolume: () => number };
type Callbacks = { state: (state: VoiceVisualState) => void; user: (text: string) => void; assistant: (text: string, final: boolean) => void; error: (message: string) => void; turn: (user: string, assistant: string) => void };
export async function startNativeVoice(session: NativeSession, stream: MediaStream, context: AudioContext, signal: AbortSignal, callbacks: Callbacks): Promise<NativeVoiceHandle> {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  let closed = false, user = '', answer = '', userPublished = false;
  const analyser = context.createAnalyser(); analyser.fftSize = 256;
  const outputVolume = () => { if (closed) return 0; const data = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(data); return Math.min(1, Math.sqrt(data.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / data.length) * 4); };
  const final = () => { if (answer.trim()) { callbacks.assistant(answer, true); callbacks.turn(user, answer); } user = ''; answer = ''; userPublished = false; };
  if (session.config.nativeProvider === 'openai') {
    const peer = new RTCPeerConnection(), audio = new Audio(); audio.autoplay = true;
    const channel = peer.createDataChannel('oai-events');
    let responseFinished = false;
    let source: MediaStreamAudioSourceNode | undefined;
    const send = (event: Record<string, unknown>) => { if (channel.readyState === 'open') channel.send(JSON.stringify(event)); };
    const stop = () => { if (closed) return; closed = true; signal.removeEventListener('abort', stop); channel.close(); peer.close(); audio.pause(); audio.srcObject = null; source?.disconnect(); analyser.disconnect(); };
    signal.addEventListener('abort', stop, { once: true });
    peer.ontrack = event => { if (closed) return; const remote = event.streams[0] || new MediaStream([event.track]); audio.srcObject = remote; source = context.createMediaStreamSource(remote); source.connect(analyser); void audio.play().catch(() => callbacks.error('Audio playback was blocked. Restart voice with a click.')); };
    peer.onconnectionstatechange = () => { if (!closed && ['failed', 'disconnected'].includes(peer.connectionState)) { callbacks.error('Realtime connection lost. Restart voice to reconnect.'); stop(); } };
    channel.onmessage = event => {
      if (closed) return;
      try { const data = JSON.parse(event.data);
        if (data.type === 'input_audio_buffer.speech_started') callbacks.state('listening');
        else if (data.type === 'input_audio_buffer.speech_stopped' || data.type === 'response.created') callbacks.state('thinking');
        else if (data.type === 'conversation.item.input_audio_transcription.completed' && data.transcript) {
          user = data.transcript; callbacks.user(user); userPublished = true;
          if (responseFinished) { responseFinished = false; final(); }
          else if (answer) callbacks.assistant(answer, false);
        }
        else if (data.type === 'conversation.item.input_audio_transcription.failed') { callbacks.error('Speech transcription failed. Restart voice and check your OpenAI transcription access.'); stop(); }
        else if (data.type === 'response.output_audio_transcript.delta' || data.type === 'response.output_text.delta') { answer += data.delta || ''; if (userPublished) callbacks.assistant(answer, false); }
        else if (data.type === 'output_audio_buffer.started') callbacks.state('speaking');
        else if (data.type === 'output_audio_buffer.stopped' || data.type === 'output_audio_buffer.cleared') callbacks.state('listening');
        else if (data.type === 'response.done') { responseFinished = true; if (userPublished) { responseFinished = false; final(); } if (data.response?.status === 'failed') { callbacks.error('The realtime provider could not complete this response.'); stop(); } }
        else if (data.type === 'error' && data.error?.code !== 'response_cancel_not_active') { callbacks.error('The realtime provider reported a session error. Check your connection and quota.'); stop(); }
      } catch { /* Ignore non-JSON transport events. */ }
    };
    try {
      stream.getAudioTracks().forEach(track => peer.addTrack(track, stream));
      const ready = new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Realtime connection timed out.')), 20000); channel.onopen = () => { clearTimeout(timer); callbacks.state('listening'); resolve(); }; channel.onclose = () => { clearTimeout(timer); reject(new Error('Realtime connection closed.')); }; });
      // Attach a rejection handler before the SDP exchange to avoid a stray
      // unhandled rejection if connection setup fails before awaiting ready.
      void ready.catch(() => {});
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
      const response = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/sdp' }, body: offer.sdp, signal });
      if (!response.ok) throw new Error(`OpenAI Realtime connection failed (${response.status}).`);
      await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() }); await ready;
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      return { stop, getOutputVolume: outputVolume, interrupt: () => { send({ type: 'response.cancel' }); send({ type: 'output_audio_buffer.clear' }); callbacks.state('listening'); } };
    } catch (error) { stop(); throw error; }
  }
  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: session.token, httpOptions: { apiVersion: 'v1beta' } });
  let capture: AudioWorkletNode | undefined, source: MediaStreamAudioSourceNode | undefined, silent: GainNode | undefined;
  let live: Awaited<ReturnType<typeof ai.live.connect>> | undefined, playbackAt = 0, receivedTurnEnd = false, discardOutput = false;
  const playing = new Set<AudioBufferSourceNode>();
  analyser.connect(context.destination);
  const interrupt = () => { for (const node of playing) { try { node.stop(); } catch {} node.disconnect(); } playing.clear(); playbackAt = 0; if (!closed) callbacks.state('listening'); };
  const stop = () => { if (closed) return; closed = true; signal.removeEventListener('abort', stop); interrupt(); if (capture) capture.port.onmessage = null; capture?.disconnect(); source?.disconnect(); silent?.disconnect(); analyser.disconnect(); live?.close(); };
  signal.addEventListener('abort', stop, { once: true });
  try {
    live = await ai.live.connect({ model: session.config.nativeModel, config: session.liveConfig,
      callbacks: { onmessage: message => {
        if (closed) return;
        const data = message.serverContent;
        if (data?.interrupted) { interrupt(); final(); discardOutput = false; return; }
        if (data?.inputTranscription?.text) { user += data.inputTranscription.text; if (!playing.size) callbacks.state('thinking'); }
        if (discardOutput) { if (data?.turnComplete) { final(); discardOutput = false; } return; }
        if (data?.outputTranscription?.text) { if (user && !userPublished) { callbacks.user(user); userPublished = true; } answer += data.outputTranscription.text; callbacks.assistant(answer, false); }
        for (const part of data?.modelTurn?.parts || []) if (part.inlineData?.data) {
          const binary = atob(part.inlineData.data), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
          const view = new DataView(bytes.buffer), sampleRate = Number(part.inlineData.mimeType?.match(/rate=(\d+)/)?.[1] || 24000);
          const buffer = context.createBuffer(1, Math.floor(bytes.length / 2), sampleRate), floats = buffer.getChannelData(0);
          for (let i = 0; i < floats.length; i++) floats[i] = view.getInt16(i * 2, true) / 32768;
          const node = context.createBufferSource(); node.buffer = buffer; node.connect(analyser); playing.add(node); receivedTurnEnd = false;
          playbackAt = Math.max(context.currentTime + .01, playbackAt); node.start(playbackAt); playbackAt += buffer.duration; callbacks.state('speaking');
          node.onended = () => { playing.delete(node); node.disconnect(); if (!closed && !playing.size && receivedTurnEnd) callbacks.state('listening'); };
        }
        if (data?.turnComplete) { receivedTurnEnd = true; final(); if (!playing.size) callbacks.state('listening'); }
      }, onerror: () => { if (!closed) { callbacks.error('Gemini Live connection failed. Check your key and model access.'); stop(); } }, onclose: () => { if (!closed) { callbacks.error('Gemini Live session ended. Restart voice to reconnect.'); stop(); } } },
    });
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    await context.audioWorklet.addModule('/voice-pcm-worklet.js');
    source = context.createMediaStreamSource(stream); capture = new AudioWorkletNode(context, 'void-pcm-capture'); silent = context.createGain(); silent.gain.value = 0;
    source.connect(capture); capture.connect(silent); silent.connect(context.destination);
    capture.port.onmessage = event => { if (closed || signal.aborted) return; const bytes = new Uint8Array(event.data); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); live?.sendRealtimeInput({ audio: { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' } }); };
    callbacks.state('listening');
    return { stop, interrupt: () => { discardOutput = playing.size > 0 || Boolean(answer); interrupt(); }, getOutputVolume: outputVolume };
  } catch (error) { stop(); throw error; }
}
