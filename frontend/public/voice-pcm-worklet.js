// Capture 20 ms PCM16 frames without blocking the UI thread.
class VoidPcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.phase = 0; this.frame = new Int16Array(320); this.offset = 0; }
  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples) for (const sample of samples) {
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.frame[this.offset++] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
        if (this.offset === this.frame.length) { this.port.postMessage(this.frame.buffer, [this.frame.buffer]); this.frame = new Int16Array(320); this.offset = 0; }
      }
    }
    return true;
  }
}
registerProcessor('void-pcm-capture', VoidPcmCapture);
