// Voice activity decision from RMS levels (SPEC 6, "Voice activity"). Pure:
// vad.ts feeds it dBFS samples at ~30 Hz; tests feed it synthetic ones.

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
export const VAD_MAX_THRESHOLD_DB = -30;
/** Voice must stay above threshold this long to count (drops clicks). */
export const VAD_ATTACK_MS = 90;
/** Voice ends after this long below the off threshold. */
export const VAD_HANGOVER_MS = 250;

const FLOOR_START_DB = -70;
const FLOOR_RISE_DB_PER_S_SILENT = 3;
const FLOOR_RISE_DB_PER_S_VOICED = 1;
const FLOOR_FALL_ALPHA = 0.2;

export function rmsToDb(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : -120;
}

export class VoiceDetector {
  floorDb = FLOOR_START_DB;
  voiced = false;
  /** Start of the current voiced stretch (valid while voiced). */
  voiceStartedAt = 0;
  lastVoicedAt = -Infinity;
  private aboveSince: number | null = null;
  private lastT: number | null = null;

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
    const dt = this.lastT === null ? 0 : Math.max(0, (t - this.lastT) / 1000);
    this.lastT = t;
    const events: VadEvent[] = [];

    // Noise floor: falls fast, rises slowly (very slowly during voice, so a
    // steady fan is eventually absorbed but speech is not).
    if (db < this.floorDb) {
      this.floorDb += (db - this.floorDb) * FLOOR_FALL_ALPHA;
    } else {
      const rate = this.voiced ? FLOOR_RISE_DB_PER_S_VOICED : FLOOR_RISE_DB_PER_S_SILENT;
      this.floorDb = Math.min(db, this.floorDb + rate * dt);
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

    return {
      frame: { t, db, floorDb: this.floorDb, thresholdDb: this.onThresholdDb, voiced: this.voiced },
      events,
    };
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
