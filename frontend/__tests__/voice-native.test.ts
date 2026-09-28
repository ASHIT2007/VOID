import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startNativeVoice } from '../lib/voice-native';
import { DEFAULT_VOICE_CONFIG } from '../lib/voice-config';
const mock = vi.hoisted(() => ({ connect: vi.fn(), liveClose: vi.fn(), input: vi.fn() }));
vi.mock('@google/genai', () => ({ GoogleGenAI: class { live = { connect: mock.connect }; } }));
let channel: any, peer: any, worklet: any;
const callbacks = () => ({ state: vi.fn(), user: vi.fn(), assistant: vi.fn(), error: vi.fn(), turn: vi.fn() });
const audioNode = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 }, fftSize: 256, getByteTimeDomainData: (values: Uint8Array) => values.fill(128) });
function context() { return { createAnalyser: () => audioNode(), createMediaStreamSource: () => audioNode(), createGain: () => audioNode(), destination: {}, audioWorklet: { addModule: vi.fn() }, currentTime: 1,
  createBuffer: (_channels: number, size: number, rate: number) => ({ duration: size / rate, getChannelData: () => new Float32Array(size) }), createBufferSource: () => ({ ...audioNode(), start: vi.fn(), stop: vi.fn() }) } as unknown as AudioContext; }
const stream = { getAudioTracks: () => [{ id: 'microphone' }] } as unknown as MediaStream;
const session = (provider: 'openai' | 'google') => ({ config: { ...DEFAULT_VOICE_CONFIG, mode: 'native' as const, nativeProvider: provider }, token: 'temporary-only', liveConfig: {} });
beforeEach(() => {
  mock.connect.mockReset(); mock.liveClose.mockReset(); mock.input.mockReset();
  vi.stubGlobal('Audio', class { autoplay = false; srcObject = null; play = vi.fn(async () => {}); pause = vi.fn(); });
  vi.stubGlobal('RTCPeerConnection', class {
    connectionState = 'connected'; addTrack = vi.fn(); close = vi.fn(() => channel.onclose?.()); createOffer = async () => ({ type: 'offer', sdp: 'offer-sdp' }); setLocalDescription = vi.fn();
    setRemoteDescription = async () => { channel.readyState = 'open'; channel.onopen(); };
    createDataChannel = () => { channel = { readyState: 'connecting', send: vi.fn(), close: vi.fn() }; return channel; };
    constructor() { peer = this; }
  });
  vi.stubGlobal('AudioWorkletNode', class { port = { onmessage: null }; connect = vi.fn(); disconnect = vi.fn(); constructor() { worklet = this; } });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('answer-sdp')));
});
afterEach(() => vi.unstubAllGlobals());
describe('native voice lifecycle', () => {
  it('connects WebRTC with the ephemeral token and closes on abort', async () => {
    const controller = new AbortController(), events = callbacks(); const handle = await startNativeVoice(session('openai'), stream, context(), controller.signal, events);
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toEqual({ Authorization: 'Bearer temporary-only', 'Content-Type': 'application/sdp' });
    expect(peer.addTrack).toHaveBeenCalledTimes(1); expect(events.state).toHaveBeenCalledWith('listening');
    handle.interrupt(); expect(channel.send.mock.calls.map((call: string[]) => JSON.parse(call[0]).type)).toEqual(['response.cancel', 'output_audio_buffer.clear']);
    controller.abort(); expect(peer.close).toHaveBeenCalledOnce(); expect(handle.getOutputVolume()).toBe(0);
  });
  it('keeps delayed user transcription before the assistant bubble and finalizes once', async () => {
    const events = callbacks(); const handle = await startNativeVoice(session('openai'), stream, context(), new AbortController().signal, events);
    const emit = (data: unknown) => channel.onmessage({ data: JSON.stringify(data) });
    emit({ type: 'response.output_audio_transcript.delta', delta: 'नमस्ते!' }); emit({ type: 'response.done', response: { status: 'completed' } });
    expect(events.assistant).not.toHaveBeenCalled();
    emit({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'Hello' });
    expect(events.user).toHaveBeenCalledExactlyOnceWith('Hello'); expect(events.assistant).toHaveBeenCalledExactlyOnceWith('नमस्ते!', true); expect(events.turn).toHaveBeenCalledExactlyOnceWith('Hello', 'नमस्ते!'); handle.stop();
  });
  it('cleans up failed WebRTC setup without a second provider attempt', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 403 }));
    await expect(startNativeVoice(session('openai'), stream, context(), new AbortController().signal, callbacks())).rejects.toThrow('403');
    expect(peer.close).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  });
  it('does not acquire a transport after cancellation', async () => {
    const controller = new AbortController(); controller.abort(); await expect(startNativeVoice(session('openai'), stream, context(), controller.signal, callbacks())).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).not.toHaveBeenCalled();
  });
  it('streams Gemini PCM and publishes one transcript per turn, then disconnects capture', async () => {
    let handlers: any; mock.connect.mockImplementation(async options => { handlers = options.callbacks; return { close: mock.liveClose, sendRealtimeInput: mock.input }; });
    const controller = new AbortController(), events = callbacks(); const handle = await startNativeVoice(session('google'), stream, context(), controller.signal, events);
    worklet.port.onmessage({ data: new Int16Array([0, 10]).buffer }); expect(mock.input).toHaveBeenCalledWith({ audio: { data: expect.any(String), mimeType: 'audio/pcm;rate=16000' } });
    handlers.onmessage({ serverContent: { inputTranscription: { text: 'कल meeting है' } } });
    handlers.onmessage({ serverContent: { outputTranscription: { text: 'हाँ, ' } } }); handlers.onmessage({ serverContent: { outputTranscription: { text: 'कल।' }, turnComplete: true } });
    expect(events.user).toHaveBeenCalledExactlyOnceWith('कल meeting है'); expect(events.turn).toHaveBeenCalledExactlyOnceWith('कल meeting है', 'हाँ, कल।');
    controller.abort(); expect(mock.liveClose).toHaveBeenCalledOnce(); expect(worklet.disconnect).toHaveBeenCalledOnce(); expect(worklet.port.onmessage).toBeNull(); handle.stop(); expect(mock.liveClose).toHaveBeenCalledOnce();
  });
});
