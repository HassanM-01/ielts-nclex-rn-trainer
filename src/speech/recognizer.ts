// Always-on speech recognition (SPEC 6, "Recognition").
//
// One recognition session at a time, restarted immediately whenever the
// browser ends it. Results are tagged by turn id (see transcript.ts), and a
// session that ends before its last result became final has that interim
// text promoted, so restarts never lose recognized text.

import { NetworkErrorWindow, restartDelayMs, STOP_TIMEOUT_MS } from "./policy";
import { SessionResults, type FinalSegment, type ResultSnapshot } from "./transcript";
import { getRecognitionCtor, type SRResultEvent, type SpeechRecognitionLike } from "./web-speech";

export type RecognizerFailure = "network" | "not-allowed" | "audio-capture" | "unsupported" | "language" | "start";
export type RestartReason = "ended" | "forced" | "preempt-examiner" | "monologue-pause" | "stall";
export type RecognizerMode = "continuous" | "push-to-talk";
export type RecognizerState = "idle" | "starting" | "running" | "restarting" | "stopped" | "failed";

export interface RecognizerCallbacks {
  /** Every result event, plus promoted text when a session ends. */
  onResult(finals: FinalSegment[], interims: Map<number, string>, now: number): void;
  /** `gapMs`: time from the previous session's capture ending to this one's starting. */
  onSessionStart(session: number, gapMs: number | null): void;
  onSessionEnd(session: number, durationMs: number, reason: RestartReason | "stopped"): void;
  onError(code: string): void;
  onFailure(failure: RecognizerFailure): void;
  onStateChange(): void;
}

const MAX_START_ATTEMPTS = 10;
const SHORT_SESSION_MS = 1_000;

export class Recognizer {
  state: RecognizerState = "idle";
  mode: RecognizerMode = "continuous";
  session = 0;
  sessionStartedAt = 0;
  lastResultAt = -Infinity;
  failure: RecognizerFailure | null = null;

  private rec: SpeechRecognitionLike | null = null;
  private results: SessionResults | null = null;
  private wantRunning = false;
  private pttHeld = false;
  private pendingRestart: RestartReason | null = null;
  private stopRequestedAt: number | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private captureEndedAt: number | null = null;
  private shortSessions = 0;
  private startAttempts = 0;
  private turnId = 0;
  private networkErrors = new NetworkErrorWindow();
  private confidenceSum = 0;
  private confidenceN = 0;
  private zeroConfidenceN = 0;

  constructor(
    private readonly lang: string,
    private readonly cb: RecognizerCallbacks,
  ) {}

  static isSupported(): boolean {
    return getRecognitionCtor() !== null;
  }

  get turn(): number {
    return this.turnId;
  }

  /** New results are tagged with this turn from now on. */
  setTurn(id: number): void {
    this.turnId = id;
  }

  /** Barge-in: pending results of `from` belong to `to`. */
  retag(from: number, to: number): void {
    this.results?.retag(from, to);
  }

  /** Average reported confidence; null if the browser never reported one. */
  get avgConfidence(): number | null {
    return this.confidenceN > 0 ? this.confidenceSum / this.confidenceN : null;
  }

  get zeroConfidenceResults(): number {
    return this.zeroConfidenceN;
  }

  sessionAge(now: number): number {
    return this.state === "running" ? now - this.sessionStartedAt : 0;
  }

  get isCapturing(): boolean {
    return this.state === "running";
  }

  /** Start continuous recognition and keep it running until stop(). */
  start(): void {
    if (this.state === "failed") return;
    this.wantRunning = true;
    if (this.mode === "continuous" && !this.rec) this.openSession();
  }

  stop(): void {
    this.wantRunning = false;
    this.pttHeld = false;
    this.pendingRestart = null;
    this.requestStop();
  }

  /** Stop the current session and start a new one straight away. */
  restart(reason: RestartReason): boolean {
    if (!this.rec || this.state !== "running" || this.mode !== "continuous") return false;
    this.pendingRestart = reason;
    this.requestStop();
    return true;
  }

  setMode(mode: RecognizerMode): void {
    this.mode = mode;
    this.failure = null;
    this.networkErrors.reset();
    if (this.state === "failed") this.state = "idle";
    if (mode === "push-to-talk") {
      this.pendingRestart = null;
      this.requestStop();
    } else if (this.wantRunning && !this.rec) {
      this.openSession();
    }
    this.cb.onStateChange();
  }

  pttDown(): void {
    if (this.mode !== "push-to-talk") return;
    this.pttHeld = true;
    if (!this.rec) this.openSession();
  }

  pttUp(): void {
    if (this.mode !== "push-to-talk") return;
    this.pttHeld = false;
    this.requestStop();
  }

  private setState(s: RecognizerState): void {
    this.state = s;
    this.cb.onStateChange();
  }

  private requestStop(): void {
    const rec = this.rec;
    const results = this.results;
    if (!rec || !results) return;
    this.stopRequestedAt = performance.now();
    try {
      rec.stop(); // stop() (not abort()) so pending speech is finalized
    } catch {
      // already stopping
    }
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => {
      if (this.rec !== rec) return;
      this.handleEnd(rec, results); // `end` never came: move on without it
      try {
        rec.abort();
      } catch {
        // ignore
      }
    }, STOP_TIMEOUT_MS);
  }

  private openSession(): void {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      this.fail("unsupported");
      return;
    }
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    // No contextual biasing (`phrases`): it would hide mispronunciations.

    const session = this.session + 1;
    const results = new SessionResults(session);

    rec.onstart = () => {
      if (this.rec !== rec) return;
      this.startAttempts = 0;
      this.sessionStartedAt = performance.now();
      this.setState("running");
    };
    rec.onaudiostart = () => {
      if (this.rec !== rec) return;
      const now = performance.now();
      const gap = this.captureEndedAt !== null ? now - this.captureEndedAt : null;
      this.captureEndedAt = null;
      this.cb.onSessionStart(session, gap);
    };
    rec.onresult = (e: SRResultEvent) => {
      if (this.rec !== rec) return;
      const now = performance.now();
      this.lastResultAt = now;
      const list: ResultSnapshot[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const alt = r?.[0];
        if (!r || !alt) continue;
        list.push({ transcript: alt.transcript, confidence: alt.confidence, isFinal: r.isFinal });
      }
      const { finals, interims } = results.apply(list, this.turnId, now);
      this.trackConfidence(finals);
      this.cb.onResult(finals, interims, now);
    };
    rec.onerror = (e) => {
      if (this.rec !== rec) return;
      this.cb.onError(e.error);
      switch (e.error) {
        case "network":
          if (this.networkErrors.record(performance.now()) && this.mode === "continuous") this.fail("network");
          break;
        case "not-allowed":
        case "service-not-allowed":
          this.fail("not-allowed");
          break;
        case "audio-capture":
          this.fail("audio-capture");
          break;
        case "language-not-supported":
          this.fail("language");
          break;
        default:
          // no-speech, aborted, etc.: `end` follows and we restart.
          break;
      }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.handleEnd(rec, results);
    };

    this.rec = rec;
    this.results = results;
    this.session = session;
    this.setState("starting");
    try {
      rec.start();
    } catch {
      // InvalidStateError if the previous session is still shutting down.
      this.rec = null;
      this.results = null;
      this.startAttempts++;
      if (this.startAttempts >= MAX_START_ATTEMPTS) {
        this.fail("start");
        return;
      }
      setTimeout(() => {
        if (!this.rec && this.shouldRun()) this.openSession();
      }, 150);
    }
  }

  private shouldRun(): boolean {
    if (this.state === "failed") return false;
    return this.mode === "continuous" ? this.wantRunning : this.pttHeld;
  }

  private handleEnd(rec: SpeechRecognitionLike, results: SessionResults): void {
    if (this.rec !== rec) return;
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    const now = performance.now();
    const promoted = results.flush(now);
    this.trackConfidence(promoted);
    // Always report, even with nothing promoted, so the UI clears interims.
    this.cb.onResult(promoted, new Map(), now);

    const duration = this.sessionStartedAt ? now - this.sessionStartedAt : 0;
    const reason: RestartReason | "stopped" = this.pendingRestart ?? (this.shouldRun() ? "ended" : "stopped");
    this.cb.onSessionEnd(this.session, duration, reason);

    this.rec = null;
    this.results = null;
    this.sessionStartedAt = 0;
    this.captureEndedAt = Math.min(this.stopRequestedAt ?? now, now);
    this.stopRequestedAt = null;

    if (this.state === "failed") return;
    if (!this.shouldRun()) {
      this.pendingRestart = null;
      this.setState(this.mode === "continuous" ? "stopped" : "idle");
      return;
    }

    this.shortSessions = !this.pendingRestart && duration < SHORT_SESSION_MS ? this.shortSessions + 1 : 0;
    const delay = this.pendingRestart ? 0 : restartDelayMs(this.shortSessions);
    this.pendingRestart = null;
    this.setState("restarting");
    if (delay === 0) this.openSession();
    else
      setTimeout(() => {
        if (!this.rec && this.shouldRun()) this.openSession();
      }, delay);
  }

  private fail(f: RecognizerFailure): void {
    if (this.state === "failed") return;
    this.failure = f;
    this.wantRunning = this.mode === "continuous" ? this.wantRunning : false;
    this.setState("failed");
    const rec = this.rec;
    const now = performance.now();
    const promoted = this.results?.flush(now) ?? [];
    this.rec = null;
    this.results = null;
    if (this.stopTimer) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
    if (promoted.length) this.cb.onResult(promoted, new Map(), now);
    try {
      rec?.abort();
    } catch {
      // ignore
    }
    this.cb.onFailure(f);
  }

  private trackConfidence(segs: FinalSegment[]): void {
    for (const s of segs) {
      if (s.promoted) continue;
      if (s.confidence > 0) {
        this.confidenceSum += s.confidence;
        this.confidenceN++;
      } else {
        this.zeroConfidenceN++;
      }
    }
  }
}
