/** MP3 bytes reach playback before the entire synthesis response downloads. */
export async function playSpeechAudio(response: Response, audio: HTMLAudioElement, signal: AbortSignal, onUrl: (url: string) => void): Promise<void> {
  let objectUrl = '';
  const abortError = () => new DOMException('Speech interrupted', 'AbortError');
  const setSource = (source: Blob | MediaSource) => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(source); onUrl(objectUrl); audio.src = objectUrl;
  };
  let rejectPlayback: (reason: unknown) => void = () => {};
  let cancelRead: () => void = () => {};
  const failPlayback = (error: unknown) => { rejectPlayback(error); cancelRead(); };
  const ended = new Promise<void>((resolve, reject) => {
    rejectPlayback = reject;
    audio.onended = () => resolve();
    audio.onerror = () => failPlayback(new Error('Voice audio playback failed'));
  });
  void ended.catch(() => {});
  const abort = () => { audio.pause(); failPlayback(abortError()); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw abortError();
    const supportsStreaming = response.body && response.headers.get('content-type')?.includes('audio/mpeg')
      && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg');
    if (!supportsStreaming) {
      setSource(await response.blob());
      if (signal.aborted) throw abortError();
      await audio.play(); await ended; return;
    }
    const media = new MediaSource();
    const opened = new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timeout); reject(abortError()); };
      const timeout = setTimeout(() => { signal.removeEventListener('abort', onAbort); reject(new Error('Audio stream startup timed out')); }, 5000);
      media.addEventListener('sourceopen', () => { clearTimeout(timeout); signal.removeEventListener('abort', onAbort); resolve(); }, { once: true });
      signal.addEventListener('abort', onAbort, { once: true });
    });
    setSource(media); await opened;
    const source = media.addSourceBuffer('audio/mpeg');
    source.mode = 'sequence';
    const reader = response.body!.getReader();
    cancelRead = () => { void reader.cancel().catch(() => {}); };
    let playing = false;
    let total = 0;
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > 10 * 1024 * 1024) throw new Error('Voice response is too large');
        if (!value.byteLength) continue;
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { source.removeEventListener('updateend', updated); source.removeEventListener('error', failed); signal.removeEventListener('abort', interrupted); };
          const updated = () => { cleanup(); resolve(); };
          const failed = () => { cleanup(); reject(new Error('Audio stream could not be decoded')); };
          const interrupted = () => { cleanup(); reject(abortError()); };
          source.addEventListener('updateend', updated, { once: true }); source.addEventListener('error', failed, { once: true }); signal.addEventListener('abort', interrupted, { once: true });
          try { source.appendBuffer(new Uint8Array(value)); } catch (error) { cleanup(); reject(error); }
        });
        if (!playing) { playing = true; void audio.play().catch(failPlayback); }
      }
      if (signal.aborted) throw abortError();
      if (!total) throw new Error('Voice provider returned empty audio');
      if (media.readyState === 'open') media.endOfStream();
      await ended;
    } finally { cancelRead = () => {}; await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } finally {
    signal.removeEventListener('abort', abort);
    audio.onended = null; audio.onerror = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
