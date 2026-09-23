// Voice activity decision from RMS levels (SPEC 6, "Voice activity"). Pure:
// vad.ts feeds it dBFS samples at ~30 Hz; tests feed it synthetic ones.
//
// Noise floor: the 10th percentile of the last 4 s of levels. Speech dips
// between words and syllables, so the low percentile stays near the room's
// noise even while someone talks; steady noise (a fan, a hum, a sensitive
// mic's hiss) becomes the floor within a few seconds instead of reading as
// endless "voice". The first third of a second after the mic opens only
// calibrates.

export interface VadFrame {
  t: number;
  db: number;
  floorDb: number;
  thresholdDb: number;
  voiced: boolean;
}

export interface VadEvent {
  type: "voice-start" | "voice-end";
  /** For voice-start: when voice began. For voice-end: last voiced sample. */
  at: number;
  /** For voice-start: the silence before it (0 for the first). */
  pauseMs: number;
}

export const VAD_ON_ABOVE_FLOOR_DB = 12;
export const VAD_OFF_ABOVE_FLOOR_DB = 7;
export const VAD_MIN_THRESHOLD_DB = -62;
export const VAD_MAX_THRESHOLD_DB = -20;
/** Voice must stay above threshold this long to count (drops clicks). */
export const VAD_ATTACK_MS = 90;
/** Voice ends after this long below the off threshold. */
export const VAD_HANGOVER_MS = 250;
/** Levels kept for the floor estimate (~4 s at 30 Hz). */
export const VAD_FLOOR_WINDOW = 120;
/** Samples used only to calibrate after the mic opens (~330 ms). */
export const VAD_CALIBRATION_SAMPLES = 10;
const FLOOR_PERCENTILE = 0.1;
const FLOOR_MIN_DB = -100;

export function rmsToDb(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : -120;
}

export class VoiceDetector {
  floorDb = -70;
  voiced = false;
  /** Start of the current voiced stretch (valid while voiced). */
  voiceStartedAt = 0;
  lastVoicedAt = -Infinity;
  private aboveSince: number | null = null;
  private history: number[] = [];

  get calibrating(): boolean {
    return this.history.length < VAD_CALIBRATION_SAMPLES;
  }

  get onThresholdDb(): number {
    return clamp(this.floorDb + VAD_ON_ABOVE_FLOOR_DB, VAD_MIN_THRESHOLD_DB, VAD_MAX_THRESHOLD_DB);
  }

  get offThresholdDb(): number {
    return Math.min(this.onThresholdDb, clamp(this.floorDb + VAD_OFF_ABOVE_FLOOR_DB, VAD_MIN_THRESHOLD_DB - 5, VAD_MAX_THRESHOLD_DB));
  }

  /** Current silence length (0 while voiced). */
  silenceMs(now: number): number {
    if (this.voiced) return 0;
    return Number.isFinite(this.lastVoicedAt) ? now - this.lastVoicedAt : 0;
  }

  feed(db: number, t: number): { frame: VadFrame; events: VadEvent[] } {
    const events: VadEvent[] = [];
    this.history.push(db);
    if (this.history.length > VAD_FLOOR_WINDOW) this.history.shift();
    this.floorDb = Math.max(FLOOR_MIN_DB, lowPercentile(this.history, FLOOR_PERCENTILE));

    if (this.calibrating) {
      return { frame: this.frame(t, db), events };
    }

    if (!this.voiced) {
      if (db >= this.onThresholdDb) {
        this.aboveSince ??= t;
        if (t - this.aboveSince >= VAD_ATTACK_MS) {
          const pauseMs = Number.isFinite(this.lastVoicedAt) ? this.aboveSince - this.lastVoicedAt : 0;
          this.voiced = true;
          this.voiceStartedAt = this.aboveSince;
          this.lastVoicedAt = t;
          events.push({ type: "voice-start", at: this.aboveSince, pauseMs: Math.max(0, pauseMs) });
        }
      } else {
        this.aboveSince = null;
      }
    } else if (db >= this.offThresholdDb) {
      this.lastVoicedAt = t;
    } else if (t - this.lastVoicedAt >= VAD_HANGOVER_MS) {
      this.voiced = false;
      this.aboveSince = null;
      events.push({ type: "voice-end", at: this.lastVoicedAt, pauseMs: 0 });
    }

    return { frame: this.frame(t, db), events };
  }

  private frame(t: number, db: number): VadFrame {
    return { t, db, floorDb: this.floorDb, thresholdDb: this.onThresholdDb, voiced: this.voiced };
  }
}

function lowPercentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? -70;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
