// Wires the recognizer, synthesizer and VAD together (SPEC 6). The step 2
// engine drives the exam through this class; the /lab page drives it
// directly.
//
// Turns: every examiner line opens an "examiner" turn and, when it ends, a
// "candidate" turn (or a "discard" turn after an examiner interruption).
// The recognizer tags each result with the turn current when it began, so
// without headphones the examiner's own voice lands in the examiner turn and
// never reaches Julio's answer.

import { Metrics } from "../metrics/latency";
import { browserVersion, currentBrowser } from "./browser";
import { nonEchoWordCount, shouldBargeIn, trimEcho } from "./echo-guard";
import { effectiveSilenceMs, isStall, shouldPreemptOnExaminerStart, shouldRestartInMonologue } from "./policy";
import { loadPrefs, savePrefs, type SpeechPrefs } from "./prefs";
import { Recognizer, type RecognizerFailure, type RestartReason } from "./recognizer";
import { Synthesizer, type LineResult } from "./synthesizer";
import { TranscriptBuffer, type FinalSegment } from "./transcript";
import { Vad, type VadOptions } from "./vad";
import type { VadEvent, VadFrame } from "./vad-detector";
import { accentOf, availableAccents, examinerName, isNatural, nextAccent, pickVoice, type Accent, type VoiceInfo } from "./voices";
import { onDeviceModelStatus } from "./web-speech";

export type TurnKind = "examiner" | "candidate" | "discard";

export interface Turn {
  id: number;
  kind: TurnKind;
  startedAt: number;
  /** Examiner turns: the line spoken. Candidate turns: the line before it (for echo trim). */
  line: string;
}

export interface SayOptions {
  /** false for examiner interruptions (Part 1 time limit, Part 2 hard stop). */
  interruptible?: boolean;
  /** Turn opened when the line ends: "discard" after an interruption. */
  then?: "candidate" | "discard";
  /** For latency: when the answer was committed, and whether the line came from the model. */
  commitAt?: number;
  source?: "scripted" | "ai";
  /** For latency: the click that started the exam. */
  clickAt?: number;
}

export interface SayResult extends LineResult {
  bargedIn: boolean;
}

const TICK_MS = 100;
export const LANG = "en-US";

export class SpeechController {
  readonly metrics: Metrics;
  readonly buffer = new TranscriptBuffer();
  readonly recognizer: Recognizer;
  readonly synth: Synthesizer;
  vad: Vad | null = null;
  vadError: string | null = null;
  vadOptions: VadOptions = { echoCancellation: true, noiseSuppression: true };
  prefs: SpeechPrefs;
  examinerSpeaking = false;
  /** The examiner's audio has actually started (examinerSpeaking covers the wait before it). */
  examinerAudible = false;
  examinerInterruptible = true;
  monologue = false;
  failure: RecognizerFailure | null = null;
  examiner = { name: "", accent: null as Accent | null };
  turns: Turn[] = [];
  /** Non-final text per turn, from the current recognition session. */
  interims = new Map<number, string>();
  /** VAD pauses inside candidate turns (ms), for fluency stats. */
  pauses: { turnId: number; ms: number }[] = [];
  started = false;
  /** Recognizer session ends that were followed by a restart. */
  restarts: { at: number; endedSession: number; reason: RestartReason; gapMs: number | null }[] = [];

  private turnSeq = 0;
  private listeners = new Set<() => void>();
  private tickListeners = new Set<(now: number) => void>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private lastStallAt = -Infinity;
  private stallStreak = 0;
  private awaitingFirstText: number | null = null;
  private awaitingFinal: number | null = null;
  private lineMeta = new Map<number, SayOptions>();
  private bargedInLines = new Set<number>();
  private manualVoice = false;
  private version = 0;
  private initPromise: Promise<void> | null = null;
  private devicesWatched = false;
  private micChangeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(metricsKey: string | null = null) {
    this.metrics = new Metrics(metricsKey);
    this.prefs = loadPrefs();
    this.turns.push(this.makeTurn("discard", ""));

    this.recognizer = new Recognizer(LANG, {
      onResult: (finals, interims, now) => this.onResult(finals, interims, now),
      onSessionStart: (session, gap) => {
        if (gap !== null) this.metrics.record("rec_restart_gap", gap);
        const last = this.restarts[this.restarts.length - 1];
        if (last && last.gapMs === null && gap !== null) last.gapMs = gap;
        this.metrics.log("rec-start", `session ${session}${gap !== null ? `, gap ${Math.round(gap)} ms` : ""}`);
      },
      onSessionEnd: (session, dur, reason) => {
        if (reason !== "stopped") {
          this.metrics.count(`restart:${reason}`);
          this.restarts.push({ at: performance.now(), endedSession: session, reason, gapMs: null });
          if (this.restarts.length > 200) this.restarts.shift();
        }
        this.metrics.log("rec-end", `session ${session} after ${(dur / 1000).toFixed(1)} s (${reason})`);
      },
      onError: (code) => {
        this.metrics.count(`rec_error:${code}`);
        this.metrics.log("rec-error", code);
      },
      onFailure: (f) => this.onFailure(f),
      onStateChange: () => this.changed(),
    });

    this.synth = new Synthesizer({
      onLineStart: (lineId, at, requestedAt) => {
        const meta = this.lineMeta.get(lineId);
        if (meta?.commitAt !== undefined) {
          this.metrics.record(meta.source === "ai" ? "commit_to_audio_ai" : "commit_to_audio_scripted", at - meta.commitAt);
        }
        if (meta?.clickAt !== undefined) this.metrics.record("click_to_speaking", at - meta.clickAt);
        this.examinerAudible = true;
        this.metrics.log("tts-line-start", `line ${lineId} +${Math.round(at - requestedAt)} ms`);
      },
      onSentenceStart: (_lineId, _index, speakToStart, gap) => {
        this.metrics.record("tts_start", speakToStart);
        if (gap !== null) this.metrics.record("tts_sentence_gap", gap);
      },
      onLineEnd: (lineId, r) => {
        this.lineMeta.delete(lineId);
        this.examinerAudible = false;
        this.metrics.log("tts-line-end", `line ${lineId}${r.cancelled ? " (cancelled)" : ""}`);
      },
      onFallback: (from, to) => {
        this.metrics.count("tts_fallbacks");
        this.metrics.log("tts-fallback", `${from.name} → ${to?.name ?? "none"}`);
      },
      onWatchdog: (lineId, i) => {
        this.metrics.count("tts_watchdogs");
        this.metrics.log("tts-watchdog", `line ${lineId} sentence ${i}`);
      },
      onStuck: (lineId, i) => {
        this.metrics.count("tts_stuck");
        this.metrics.log("tts-stuck", `line ${lineId} sentence ${i}`);
      },
      onVoicesChanged: () => {
        if (!this.manualVoice) this.chooseVoice(false);
        this.changed();
      },
    });
  }

  // ---- setup ---------------------------------------------------------------

  /** Loads voices and records the engine. No mic, no gesture needed. */
  init(): Promise<void> {
    this.initPromise ??= this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const browser = currentBrowser();
    this.metrics.setInfo("browser", `${browser} ${browserVersion(navigator.userAgent, browser)}`.trim());
    this.metrics.setInfo("recognition_supported", Recognizer.isSupported());
    this.metrics.setInfo("synthesis_supported", Synthesizer.isSupported());
    void onDeviceModelStatus(LANG).then((s) => this.metrics.setInfo("on_device_model", s));
    await this.synth.init();
    this.chooseVoice(true);
    this.changed();
  }

  /** Picks this session's examiner voice: pinned voice, else rotated accent. */
  private chooseVoice(rotate: boolean): void {
    const voices = this.synth.voices;
    let voice: VoiceInfo | null = null;
    if (this.prefs.pinnedVoiceURI) {
      voice = voices.find((v) => v.voiceURI === this.prefs.pinnedVoiceURI) ?? null;
      this.manualVoice = voice !== null;
    }
    if (!voice) {
      const accent = rotate
        ? nextAccent(availableAccents(voices), this.prefs.lastAccent, this.prefs.pinnedAccent)
        : (this.examiner.accent ?? this.prefs.pinnedAccent);
      voice = pickVoice(voices, accent);
      // Edge loads Natural voices late: upgrade only if we'd get a better one.
      if (!rotate && this.synth.voice && voice && isNatural(this.synth.voice)) voice = this.synth.voice;
    }
    this.applyVoice(voice);
    if (rotate && this.examiner.accent) {
      this.prefs.lastAccent = this.examiner.accent;
      savePrefs(this.prefs);
    }
  }

  private applyVoice(voice: VoiceInfo | null): void {
    this.synth.voice = voice;
    this.examiner = { name: voice ? examinerName(voice) : "", accent: voice ? accentOf(voice.lang) : null };
    this.metrics.setInfo("voice", voice?.name ?? null);
    this.metrics.setInfo("voice_lang", voice?.lang ?? null);
    this.metrics.setInfo("voice_online", voice ? !voice.localService : null);
    this.metrics.setInfo("examiner_name", this.examiner.name || null);
  }

  /** Voice picker: pin a specific voice (persisted), or null for automatic. */
  pinVoice(voiceURI: string | null): void {
    this.prefs.pinnedVoiceURI = voiceURI;
    this.manualVoice = voiceURI !== null;
    savePrefs(this.prefs);
    if (voiceURI) this.applyVoice(this.synth.voices.find((v) => v.voiceURI === voiceURI) ?? null);
    else this.chooseVoice(false);
    this.changed();
  }

  pinAccent(accent: Accent | null): void {
    this.prefs.pinnedAccent = accent;
    savePrefs(this.prefs);
    if (!this.manualVoice) {
      this.examiner.accent = accent;
      this.applyVoice(pickVoice(this.synth.voices, accent ?? this.examiner.accent));
    }
    this.changed();
  }

  /** Use a voice for this session only (resuming an exam), without pinning it. */
  useSessionVoice(voiceURI: string | null): void {
    const voice = voiceURI ? this.synth.voices.find((v) => v.voiceURI === voiceURI) : undefined;
    if (voice) this.applyVoice(voice);
    this.changed();
  }

  setRate(rate: number): void {
    this.synth.rate = rate;
    this.changed();
  }

  setHeadphones(on: boolean): void {
    this.prefs.headphones = on;
    savePrefs(this.prefs);
    this.metrics.setInfo("headphones", on);
    this.changed();
  }

  markMicNoticeSeen(): void {
    this.prefs.micNoticeSeen = true;
    savePrefs(this.prefs);
  }

  markMicCheckDone(): void {
    this.prefs.micCheckDone = true;
    savePrefs(this.prefs);
    this.changed();
  }

  setMonologue(on: boolean): void {
    this.monologue = on;
    this.changed();
  }

  // ---- start / stop --------------------------------------------------------

  /** Call from a click: opens the VAD stream and starts the recognizer. */
  async start(): Promise<void> {
    this.started = true;
    this.startTicker();
    this.startRecognizer();
    await this.openVad();
    this.changed();
  }

  startRecognizer(): void {
    this.started = true;
    this.watchDevices();
    this.startTicker();
    this.recognizer.start();
    this.metrics.setInfo("recognizer_mode", this.recognizer.mode);
  }

  async openVad(options: VadOptions = this.vadOptions): Promise<void> {
    this.closeVad();
    this.vadOptions = options;
    const { vad, error } = await Vad.open(
      options,
      (f) => this.onVadFrame(f),
      (e) => this.onVadEvent(e),
      () => this.onMicChange("ended"),
    );
    this.vad = vad;
    this.vadError = error;
    this.metrics.setInfo("mic", vad ? vad.micLabel || "unknown" : null);
    this.metrics.setInfo("vad", vad ? "on" : `off (${error ?? "unknown"})`);
    this.metrics.setInfo("vad_echo_cancellation", vad ? vad.appliedEchoCancellation : null);
    this.metrics.log("vad", vad ? `opened, echoCancellation=${String(vad.appliedEchoCancellation)}` : `failed: ${error}`);
    this.startTicker();
    this.changed();
  }

  /** The microphone in use (from the VAD stream), or "" if unknown. */
  get micLabel(): string {
    return this.vad?.micLabel ?? "";
  }

  /**
   * A mic was plugged in or unplugged (e.g. headphones). Reopen the VAD
   * stream on the new default and, if the device actually changed, restart
   * the recognizer so it captures from it too. No reload needed.
   */
  private watchDevices(): void {
    if (this.devicesWatched || !navigator.mediaDevices) return;
    this.devicesWatched = true;
    navigator.mediaDevices.addEventListener("devicechange", () => this.onMicChange("devicechange"));
  }

  private onMicChange(reason: "devicechange" | "ended"): void {
    if (this.micChangeTimer) clearTimeout(this.micChangeTimer);
    // Devices often arrive in bursts (a headset adds a mic and a speaker).
    this.micChangeTimer = setTimeout(() => void this.switchMic(reason), 500);
  }

  private async switchMic(reason: "devicechange" | "ended"): Promise<void> {
    if (!this.started) return;
    const before = { group: this.vad?.groupId ?? "", label: this.micLabel };
    await this.openVad();
    const after = { group: this.vad?.groupId ?? "", label: this.micLabel };
    if (reason === "ended" || before.group !== after.group) {
      this.metrics.count("mic_changes");
      this.metrics.log("mic-change", `${before.label || "?"} → ${after.label || "?"} (${reason})`);
      this.recognizer.restart("mic-change");
    }
  }

  closeVad(): void {
    this.vad?.close();
    this.vad = null;
    this.changed();
  }

  stop(): void {
    this.started = false;
    this.synth.cancel();
    this.recognizer.stop();
    this.closeVad();
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.changed();
  }

  forceRestart(): void {
    if (this.recognizer.restart("forced")) this.metrics.log("forced-restart");
  }

  /** Lab: simulate a failure and fall back to push-to-talk. */
  usePushToTalk(): void {
    this.failure = "network";
    this.metrics.log("rec-failure", "simulated network failure");
    this.recognizer.setMode("push-to-talk");
    this.metrics.setInfo("recognizer_mode", "push-to-talk");
    this.changed();
  }

  useContinuous(): void {
    this.failure = null;
    this.recognizer.setMode("continuous");
    this.metrics.setInfo("recognizer_mode", "continuous");
    this.changed();
  }

  pttDown(): void {
    this.recognizer.pttDown();
  }

  pttUp(): void {
    this.recognizer.pttUp();
  }

  // ---- turns ---------------------------------------------------------------

  get currentTurn(): Turn {
    return this.turns[this.turns.length - 1] ?? this.makeTurn("discard", "");
  }

  private makeTurn(kind: TurnKind, line: string): Turn {
    return { id: ++this.turnSeq, kind, startedAt: performance.now(), line };
  }

  /** Opens a new turn; results from now on belong to it. */
  newTurn(kind: TurnKind, line = this.lastExaminerLine()): Turn {
    const t = this.makeTurn(kind, line);
    this.turns.push(t);
    if (this.turns.length > 200) this.turns.shift();
    this.recognizer.setTurn(t.id);
    this.changed();
    return t;
  }

  lastExaminerLine(): string {
    for (let i = this.turns.length - 1; i >= 0; i--) {
      const t = this.turns[i];
      if (t?.kind === "examiner") return t.line;
    }
    return "";
  }

  /** Final plus interim text of a turn. */
  turnText(turnId: number): string {
    const final = this.buffer.text(turnId);
    let interim = this.interims.get(turnId) ?? "";
    if (interim && this.buffer.segments(turnId).length === 0) {
      const turn = this.turns.find((t) => t.id === turnId);
      if (turn?.kind === "candidate") interim = trimEcho(turn.line, interim);
    }
    return [final, interim].filter(Boolean).join(" ");
  }

  /** VAD heard voice within the last `ms` (text may not have arrived yet). */
  voicedRecently(now: number, ms = 1_000): boolean {
    const d = this.vad?.detector;
    if (!d) return false;
    return d.voiced || now - d.lastVoicedAt < ms;
  }

  /**
   * Silence since Julio last spoke. Uses the shorter of the VAD silence and
   * the time since the last recognition result, so a VAD threshold that
   * misses a quiet voice can't end a turn while text is still arriving.
   */
  silenceMs(now: number): number {
    const sinceResult = Number.isFinite(this.recognizer.lastResultAt) ? now - this.recognizer.lastResultAt : Infinity;
    return effectiveSilenceMs(this.vad ? this.vad.detector.silenceMs(now) : null, sinceResult);
  }

  // ---- examiner ------------------------------------------------------------

  /** Speaks an examiner line; opens the candidate (or discard) turn after it. */
  async say(text: string, opts: SayOptions = {}): Promise<SayResult> {
    const now = performance.now();
    if (this.recognizer.isCapturing && shouldPreemptOnExaminerStart(this.recognizer.sessionAge(now))) {
      this.recognizer.restart("preempt-examiner");
    }
    const myTurn = this.newTurn("examiner", text);
    this.examinerSpeaking = true;
    this.examinerInterruptible = opts.interruptible ?? true;
    const promise = this.synth.speak(text);
    const lineId = this.synth.currentLineId;
    if (lineId !== null) this.lineMeta.set(lineId, opts);
    this.changed();

    const result = await promise;
    const bargedIn = lineId !== null && this.bargedInLines.delete(lineId);
    // A later say() may already have taken over; only close our own line.
    if (this.synth.currentLineId === null) this.examinerSpeaking = false;
    if (!bargedIn && this.currentTurn === myTurn) {
      const next = this.newTurn(opts.then ?? "candidate", text);
      if (next.kind === "candidate" && this.prefs.headphones) this.carryPending(myTurn.id, next.id);
    }
    this.changed();
    return { ...result, bargedIn };
  }

  /** Stop the examiner mid-line (engine use; not barge-in). */
  cancelSpeech(): void {
    this.synth.cancel();
  }

  /**
   * Headphones: an answer that starts right as the examiner stops can be
   * merged by the recognizer into a result that began during the examiner's
   * line (e.g. faint headphone sound in a sensitive mic). Move results that
   * aren't final yet into Julio's turn; echo trim strips any examiner words.
   */
  private carryPending(from: number, to: number): void {
    this.recognizer.retag(from, to);
    const interim = this.interims.get(from);
    if (interim) {
      this.interims.delete(from);
      this.interims.set(to, interim);
      this.metrics.log("carry", `"${interim}"`);
    }
  }

  private bargeIn(): void {
    const lineId = this.synth.currentLineId;
    const exTurn = this.currentTurn;
    if (lineId === null || exTurn.kind !== "examiner") return;
    const cand = this.makeTurn("candidate", exTurn.line);
    this.turns.push(cand);
    this.recognizer.retag(exTurn.id, cand.id);
    this.buffer.move(exTurn.id, cand.id);
    const interim = this.interims.get(exTurn.id);
    if (interim) {
      this.interims.delete(exTurn.id);
      this.interims.set(cand.id, interim);
    }
    this.recognizer.setTurn(cand.id);
    this.bargedInLines.add(lineId);
    this.examinerSpeaking = false;
    this.synth.cancel();
    this.metrics.count("barge_ins");
    this.metrics.log("barge-in", `line ${lineId}`);
  }

  // ---- recognizer and VAD events -----------------------------------------

  private onResult(finals: FinalSegment[], interims: Map<number, string>, now: number): void {
    for (const seg of finals) {
      const turn = this.turns.find((t) => t.id === seg.turnId);
      const isFirst = this.buffer.segments(seg.turnId).length === 0;
      this.buffer.add(seg);
      if (turn?.kind === "candidate" && isFirst) {
        const heard = seg.text;
        const trimmed = trimEcho(turn.line, heard);
        if (trimmed !== heard) {
          this.buffer.replaceText(seg.turnId, 0, trimmed);
          this.metrics.count("echo_trims");
          this.metrics.log("echo-trim", `"${heard}" → "${trimmed}"`);
        }
      }
      if (seg.promoted) {
        this.metrics.count("promoted_interims");
        this.metrics.log("promoted", seg.text);
      }
    }
    this.interims = interims;

    if (this.awaitingFirstText !== null && (finals.length > 0 || interims.size > 0)) {
      this.metrics.record("rec_first_interim", now - this.awaitingFirstText);
      this.awaitingFirstText = null;
    }
    if (this.awaitingFinal !== null && finals.some((f) => !f.promoted) && !this.vad?.detector.voiced) {
      this.metrics.record("rec_final_lag", now - this.awaitingFinal);
      this.awaitingFinal = null;
    }
    if (finals.length) {
      const avg = this.recognizer.avgConfidence;
      this.metrics.setInfo("avg_confidence", avg === null ? "not reported" : Number(avg.toFixed(3)));
      this.metrics.setInfo("zero_confidence_results", this.recognizer.zeroConfidenceResults);
    }

    if (this.examinerSpeaking) {
      const turn = this.currentTurn;
      const words = nonEchoWordCount(turn.line, this.turnText(turn.id));
      if (
        shouldBargeIn({
          headphones: this.prefs.headphones,
          examinerSpeaking: turn.kind === "examiner",
          interruptible: this.examinerInterruptible,
          vadVoiced: this.vad ? this.vad.detector.voiced || this.vad.detector.silenceMs(now) < 500 : null,
          recognizedWords: words,
        })
      ) {
        this.bargeIn();
      }
    }
    this.changed();
  }

  private onVadFrame(_f: VadFrame): void {
    this.changed();
  }

  private onVadEvent(e: VadEvent): void {
    const turn = this.currentTurn;
    if (turn.kind !== "candidate" || !this.recognizer.isCapturing) return;
    if (e.type === "voice-start") {
      this.awaitingFirstText = e.at;
      if (e.pauseMs > 0 && e.at - e.pauseMs >= turn.startedAt) this.pauses.push({ turnId: turn.id, ms: e.pauseMs });
    } else {
      this.awaitingFinal = e.at;
    }
  }

  private onFailure(f: RecognizerFailure): void {
    this.failure = f;
    this.metrics.count(`rec_failure:${f}`);
    this.metrics.log("rec-failure", f);
    if (f !== "unsupported") {
      this.recognizer.setMode("push-to-talk");
      this.metrics.setInfo("recognizer_mode", "push-to-talk");
    }
    this.changed();
  }

  // ---- tick ----------------------------------------------------------------

  private startTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const now = performance.now();
    const rec = this.recognizer;
    const vad = this.vad;
    // Stalls only count while Julio has the floor: during examiner audio the
    // VAD can hear the examiner (speakers, or a sensitive mic near
    // headphones), and a restart there can swallow the start of his answer.
    const listening = !this.examinerSpeaking && this.currentTurn.kind === "candidate";
    if (rec.isCapturing && vad && listening) {
      const d = vad.detector;
      const lastResult = Math.max(rec.lastResultAt, rec.sessionStartedAt, this.currentTurn.startedAt);
      if (rec.lastResultAt > this.lastStallAt) this.stallStreak = 0; // text came back
      if (isStall({ now, voiced: d.voiced, voiceStartedAt: d.voiceStartedAt, lastResultAt: lastResult, lastStallAt: this.lastStallAt, streak: this.stallStreak })) {
        this.lastStallAt = now;
        this.stallStreak++;
        this.metrics.count("stalls");
        this.metrics.log("stall", `voice for 3 s with no text in turn #${this.currentTurn.id}; restarting`);
        rec.restart("stall");
      } else if (this.monologue && !d.voiced && shouldRestartInMonologue(rec.sessionAge(now), d.silenceMs(now))) {
        rec.restart("monologue-pause");
      }
    }
    for (const fn of this.tickListeners) fn(now);
    this.changed();
  }

  /** One tick drives every clock and timing rule. */
  onTick(fn: (now: number) => void): () => void {
    this.tickListeners.add(fn);
    return () => this.tickListeners.delete(fn);
  }

  // ---- subscription ---------------------------------------------------------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    const unsubMetrics = this.metrics.subscribe(fn);
    return () => {
      this.listeners.delete(fn);
      unsubMetrics();
    };
  }

  /** subscribe() bound to this instance, stable for React effect deps. */
  readonly subscribeBound = (fn: () => void) => this.subscribe(fn);

  getVersion(): number {
    return this.version;
  }

  private changed(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }
}
