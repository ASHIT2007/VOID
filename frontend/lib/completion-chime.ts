const NOTE_ENVELOPE_FLOOR = 0.0001;

type BrowserWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

export type CompletionChimeController = {
  prime: () => Promise<void>;
  play: () => Promise<void>;
  destroy: () => Promise<void>;
};

/**
 * Creates a small Web Audio chime without loading or shipping an audio file.
 * Priming happens during the user's submit click so browsers allow the sound
 * to play later, after a background-tab generation has completed.
 */
export function createCompletionChime(): CompletionChimeController {
  let context: AudioContext | null = null;

  const getContext = () => {
    if (context && context.state !== "closed") return context;
    if (typeof window === "undefined") return null;

    const AudioContextConstructor = window.AudioContext
      || (window as BrowserWindow).webkitAudioContext;
    if (!AudioContextConstructor) return null;

    context = new AudioContextConstructor();
    return context;
  };

  const prime = async () => {
    const audioContext = getContext();
    if (audioContext?.state === "suspended") {
      await audioContext.resume();
    }
  };

  const play = async () => {
    const audioContext = getContext();
    if (!audioContext) return;
    if (audioContext.state === "suspended") await audioContext.resume();

    const startAt = audioContext.currentTime + 0.03;
    const master = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(2200, startAt);
    filter.Q.setValueAtTime(0.35, startAt);
    master.gain.setValueAtTime(0.72, startAt);
    filter.connect(master);
    master.connect(audioContext.destination);

    // Three overlapping sine notes form a soft 2.35-second completion tone.
    const notes = [
      { frequency: 440, offset: 0, duration: 1.48, volume: 0.04 },
      { frequency: 554.37, offset: 0.42, duration: 1.48, volume: 0.035 },
      { frequency: 659.25, offset: 0.84, duration: 1.48, volume: 0.03 },
    ];

    for (const note of notes) {
      const noteStart = startAt + note.offset;
      const noteEnd = noteStart + note.duration;
      const oscillator = audioContext.createOscillator();
      const envelope = audioContext.createGain();

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note.frequency, noteStart);
      envelope.gain.setValueAtTime(NOTE_ENVELOPE_FLOOR, noteStart);
      envelope.gain.exponentialRampToValueAtTime(note.volume, noteStart + 0.07);
      envelope.gain.exponentialRampToValueAtTime(NOTE_ENVELOPE_FLOOR, noteEnd);

      oscillator.connect(envelope);
      envelope.connect(filter);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd);
    }

    const cleanupAt = startAt + 2.4;
    window.setTimeout(() => {
      filter.disconnect();
      master.disconnect();
    }, Math.max(0, (cleanupAt - audioContext.currentTime) * 1000));
  };

  const destroy = async () => {
    if (context && context.state !== "closed") await context.close();
    context = null;
  };

  return { prime, play, destroy };
}
