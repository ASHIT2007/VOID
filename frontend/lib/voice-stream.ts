type Playback = () => Promise<void>;
type Job = { text: string; ready?: Promise<Playback> };

/** Starts with a short phrase, prefetches one ahead, and plays in strict order. */
export class StreamingSpeechQueue {
  private buffer = '';
  private jobs: Job[] = [];
  private controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private finished = false;
  private first = true;
  constructor(private prepare: (text: string, signal: AbortSignal) => Promise<Playback>, private onComplete: () => void, private onError: (error: unknown) => void) {}
  push(delta: string) {
    if (this.finished || this.controller.signal.aborted) return;
    this.buffer += delta;
    this.extract(false);
    if (!this.timer && this.buffer) this.timer = setTimeout(() => { this.timer = undefined; this.extract(true); }, 180);
  }
  finish() {
    if (this.finished || this.controller.signal.aborted) return;
    clearTimeout(this.timer); this.timer = undefined;
    if (this.buffer.trim()) this.enqueue(this.buffer);
    this.buffer = ''; this.finished = true;
    if (!this.running) this.onComplete();
  }
  cancel() { clearTimeout(this.timer); this.timer = undefined; this.controller.abort(); this.jobs = []; this.buffer = ''; }
  private extract(timed: boolean) {
    while (this.buffer.trim()) {
      const limit = this.first ? 64 : 160;
      const boundary = /[!?。！？।؟](?:\s|$)|\.(?:\s|$)|[,;:，；：](?:\s|$)/u.exec(this.buffer);
      let cut = boundary ? boundary.index + boundary[0].length : 0;
      if (!cut || cut > limit) {
        const slice = this.buffer.slice(0, limit);
        const words = [...slice.matchAll(/\s+/g)];
        const lastSpace = words.at(-1);
        const enough = this.buffer.length >= limit || timed && (words.length >= 3 || /[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{S}]/u.test(slice) && slice.length >= 16);
        cut = enough ? lastSpace ? lastSpace.index! + lastSpace[0].length : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(slice) ? slice.length : 0 : 0;
      }
      if (!cut) break;
      this.enqueue(this.buffer.slice(0, cut)); this.buffer = this.buffer.slice(cut);
    }
    if (timed && this.buffer && !this.timer) this.timer = setTimeout(() => { this.timer = undefined; this.extract(true); }, 180);
  }
  private enqueue(text: string) {
    const clean = text.trim(); if (!clean) return;
    this.first = false;
    this.jobs.push({ text: clean }); this.prefetch();
    if (!this.running) void this.play();
  }
  private prefetch() {
    for (const job of this.jobs.slice(0, 2)) if (!job.ready) {
      job.ready = this.prepare(job.text, this.controller.signal);
      // A prepared second phrase can reject before playback reaches it.
      void job.ready.catch(() => {});
    }
  }
  private async play() {
    this.running = true;
    try {
      while (this.jobs.length && !this.controller.signal.aborted) {
        this.prefetch();
        const playback = await this.jobs[0].ready!;
        if (this.controller.signal.aborted) return;
        await playback();
        if (this.controller.signal.aborted) return;
        this.jobs.shift(); this.prefetch();
      }
      if (this.finished && !this.controller.signal.aborted) this.onComplete();
    } catch (error) {
      if (!this.controller.signal.aborted) { this.cancel(); this.onError(error); }
    } finally { this.running = false; }
  }
}
