import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playSpeechAudio } from '@/lib/voice-audio';

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
class FakeAudio {
  src = '';
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
}
class FakeSourceBuffer extends EventTarget {
  mode = '';
  appendBuffer = vi.fn(() => { queueMicrotask(() => this.dispatchEvent(new Event('updateend'))); });
}
let audio: FakeAudio;
class FakeMediaSource extends EventTarget {
  static isTypeSupported = () => true;
  readyState = 'open';
  buffer = new FakeSourceBuffer();
  addSourceBuffer() { return this.buffer; }
  endOfStream() { this.readyState = 'ended'; queueMicrotask(() => audio.onended?.()); }
}
beforeEach(() => {
  audio = new FakeAudio();
  vi.stubGlobal('MediaSource', FakeMediaSource);
  vi.spyOn(URL, 'createObjectURL').mockImplementation(source => {
    if (source instanceof FakeMediaSource) queueMicrotask(() => source.dispatchEvent(new Event('sourceopen')));
    return 'blob:voice-test';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('progressive speech audio', () => {
  it('starts playback from the first MP3 bytes before the provider closes its stream', async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { upstream = controller; } }), { headers: { 'Content-Type': 'audio/mpeg' } });
    const finished = vi.fn();
    const playback = playSpeechAudio(response, audio as unknown as HTMLAudioElement, new AbortController().signal, vi.fn()).then(finished);
    upstream.enqueue(new Uint8Array([1, 2, 3])); await settle();
    expect(audio.play).toHaveBeenCalledTimes(1); expect(finished).not.toHaveBeenCalled();
    upstream.enqueue(new Uint8Array([4, 5])); upstream.close(); await playback;
    expect(finished).toHaveBeenCalledTimes(1); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:voice-test');
  });
  it('cancels an unfinished upstream stream when speech is interrupted', async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn(); const controller = new AbortController();
    const response = new Response(new ReadableStream<Uint8Array>({ start(stream) { upstream = stream; }, cancel }), { headers: { 'Content-Type': 'audio/mpeg' } });
    const playback = playSpeechAudio(response, audio as unknown as HTMLAudioElement, controller.signal, vi.fn());
    const rejection = expect(playback).rejects.toMatchObject({ name: 'AbortError' });
    upstream.enqueue(new Uint8Array([1, 2, 3])); await settle(); controller.abort(); await rejection;
    expect(cancel).toHaveBeenCalled(); expect(audio.pause).toHaveBeenCalled(); expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
  it('uses the short phrase blob on browsers without MP3 MediaSource support', async () => {
    vi.stubGlobal('MediaSource', undefined);
    const response = new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } });
    const playback = playSpeechAudio(response, audio as unknown as HTMLAudioElement, new AbortController().signal, vi.fn());
    await settle(); expect(audio.play).toHaveBeenCalledTimes(1); audio.onended?.(); await playback;
    expect(audio.src).toBe('blob:voice-test');
  });
  it('stops downloading when the browser rejects audio playback', async () => {
    audio.play.mockRejectedValueOnce(new Error('Playback denied'));
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ start(stream) { upstream = stream; }, cancel }), { headers: { 'Content-Type': 'audio/mpeg' } });
    const playback = playSpeechAudio(response, audio as unknown as HTMLAudioElement, new AbortController().signal, vi.fn());
    const rejection = expect(playback).rejects.toThrow('Playback denied');
    upstream.enqueue(new Uint8Array([1, 2, 3])); await rejection; expect(cancel).toHaveBeenCalled();
  });
});
