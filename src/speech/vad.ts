// Voice activity from a separate mic stream (SPEC 6, "Voice activity").
// If this stream fails, the app runs without it; nothing else may break.

import { rmsToDb, VoiceDetector, type VadEvent, type VadFrame } from "./vad-detector";

export interface VadOptions {
  echoCancellation: boolean;
  noiseSuppression: boolean;
}

const SAMPLE_INTERVAL_MS = 33; // ~30 Hz

export class Vad {
  readonly detector = new VoiceDetector();
  lastFrame: VadFrame | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private buf: Float32Array<ArrayBuffer>;
  private closed = false;

  private constructor(
    readonly stream: MediaStream,
    readonly options: VadOptions,
    private readonly ctx: AudioContext,
    private readonly analyser: AnalyserNode,
    private readonly onFrame: (f: VadFrame) => void,
    private readonly onEvent: (e: VadEvent) => void,
  ) {
    this.buf = new Float32Array(analyser.fftSize);
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
  }

  /** Opens the mic stream; returns null (never throws) if it can't. */
  static async open(
    options: VadOptions,
    onFrame: (f: VadFrame) => void,
    onEvent: (e: VadEvent) => void,
  ): Promise<{ vad: Vad | null; error: string | null }> {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: options.echoCancellation, noiseSuppression: options.noiseSuppression },
      });
      const ctx = new AudioContext();
      if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      return { vad: new Vad(stream, options, ctx, analyser, onFrame, onEvent), error: null };
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop());
      return { vad: null, error: err instanceof Error ? err.name || err.message : String(err) };
    }
  }

  /** The echoCancellation setting the browser actually applied. */
  get appliedEchoCancellation(): boolean | null {
    const s = this.stream.getAudioTracks()[0]?.getSettings();
    return typeof s?.echoCancellation === "boolean" ? s.echoCancellation : null;
  }

  get alive(): boolean {
    return !this.closed && this.stream.getAudioTracks().some((t) => t.readyState === "live");
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close().catch(() => undefined);
  }

  private sample(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const x = this.buf[i] ?? 0;
      sum += x * x;
    }
    const db = rmsToDb(Math.sqrt(sum / this.buf.length));
    const { frame, events } = this.detector.feed(db, performance.now());
    this.lastFrame = frame;
    for (const e of events) this.onEvent(e);
    this.onFrame(frame);
  }
}
