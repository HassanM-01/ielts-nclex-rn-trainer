// Examiner voice (SPEC 6, "Synthesis").
//
// One utterance per sentence, spoken in sequence. Each utterance is held in
// a Set until it ends (Chrome can garbage-collect it and never fire `end`),
// with a watchdog in case `end` never comes. An online voice that doesn't
// start within 1.5 s is cancelled and the rest of the line is spoken with a
// local voice.

import {
  LOCAL_VOICE_START_TIMEOUT_MS,
  ONLINE_VOICE_START_TIMEOUT_MS,
  utteranceWatchdogMs,
} from "./policy";
import { splitSentences } from "./text";
import { accentOf, pickLocalFallback, type VoiceInfo } from "./voices";

export interface LineResult {
  cancelled: boolean;
  fellBack: boolean;
  watchdogs: number;
  skipped: number;
}

export interface SynthCallbacks {
  /** First audio of a line. `requestedAt` is when speak() was called. */
  onLineStart(lineId: number, at: number, requestedAt: number): void;
  onSentenceStart(lineId: number, index: number, speakToStartMs: number, gapMs: number | null, voice: VoiceInfo): void;
  onLineEnd(lineId: number, result: LineResult): void;
  onFallback(from: VoiceInfo, to: VoiceInfo | null): void;
  onWatchdog(lineId: number, index: number): void;
  onStuck(lineId: number, index: number): void;
  onVoicesChanged(): void;
}

interface Line {
  id: number;
  sentences: string[];
  voice: VoiceInfo;
  rate: number;
  requestedAt: number;
  started: boolean;
  done: boolean;
  token: number;
  lastEndAt: number | null;
  result: LineResult;
  startTimer: ReturnType<typeof setTimeout> | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  resolve: (r: LineResult) => void;
}

function toInfo(v: SpeechSynthesisVoice): VoiceInfo {
  return { name: v.name, lang: v.lang, localService: v.localService, voiceURI: v.voiceURI, default: v.default };
}

export class Synthesizer {
  voices: VoiceInfo[] = [];
  voice: VoiceInfo | null = null;
  rate = 1;
  private native = new Map<string, SpeechSynthesisVoice>();
  private line: Line | null = null;
  private lineSeq = 0;
  private tokenSeq = 0;
  private utterances = new Set<SpeechSynthesisUtterance>();

  constructor(private readonly cb: SynthCallbacks) {}

  static isSupported(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  get speaking(): boolean {
    return this.line !== null;
  }

  get currentLineId(): number | null {
    return this.line?.id ?? null;
  }

  /** Loads voices, waiting for `voiceschanged` (Chrome loads them async). */
  init(timeoutMs = 2_500): Promise<VoiceInfo[]> {
    if (!Synthesizer.isSupported()) return Promise.resolve([]);
    const synth = window.speechSynthesis;
    synth.addEventListener("voiceschanged", () => {
      this.refresh();
      this.cb.onVoicesChanged();
    });
    this.refresh();
    if (this.voices.length > 0) return Promise.resolve(this.voices);
    return new Promise((resolve) => {
      const done = () => {
        synth.removeEventListener("voiceschanged", done);
        clearTimeout(timer);
        this.refresh();
        resolve(this.voices);
      };
      const timer = setTimeout(done, timeoutMs);
      synth.addEventListener("voiceschanged", done);
    });
  }

  setVoice(voiceURI: string): void {
    this.voice = this.voices.find((v) => v.voiceURI === voiceURI) ?? this.voice;
  }

  /** Speaks a line; resolves when it ends or is cancelled. */
  speak(text: string, rate = this.rate): Promise<LineResult> {
    this.cancel();
    const sentences = splitSentences(text);
    const result: LineResult = { cancelled: false, fellBack: false, watchdogs: 0, skipped: 0 };
    const voice = this.voice;
    if (!Synthesizer.isSupported() || sentences.length === 0 || !voice) return Promise.resolve(result);

    return new Promise<LineResult>((resolve) => {
      const line: Line = {
        id: ++this.lineSeq,
        sentences,
        voice,
        rate,
        requestedAt: performance.now(),
        started: false,
        done: false,
        token: 0,
        lastEndAt: null,
        result,
        startTimer: null,
        watchdog: null,
        resolve,
      };
      this.line = line;
      const synth = window.speechSynthesis;
      if (synth.speaking || synth.pending) synth.cancel();
      if (synth.paused) synth.resume();
      this.speakSentence(line, 0);
    });
  }

  /** Stops the current line (barge-in, examiner interruption, reset). */
  cancel(): void {
    const line = this.line;
    if (!line) return;
    line.result.cancelled = true;
    this.clearTimers(line);
    window.speechSynthesis.cancel();
    this.endLine(line);
  }

  private refresh(): void {
    const list = window.speechSynthesis.getVoices();
    this.native = new Map(list.map((v) => [v.voiceURI, v]));
    this.voices = list.map(toInfo);
    if (this.voice && !this.native.has(this.voice.voiceURI)) this.voice = null;
  }

  private speakSentence(line: Line, index: number): void {
    if (line.done) return;
    const text = line.sentences[index] ?? "";
    const u = new SpeechSynthesisUtterance(text);
    const nv = this.native.get(line.voice.voiceURI);
    if (nv) {
      u.voice = nv;
      u.lang = nv.lang;
    }
    u.rate = line.rate;
    const token = ++this.tokenSeq;
    line.token = token;
    this.utterances.add(u);
    const calledAt = performance.now();
    const stale = () => line.done || line.token !== token;

    line.startTimer = setTimeout(
      () => {
        if (stale()) return;
        this.onNoStart(line, index);
      },
      line.voice.localService ? LOCAL_VOICE_START_TIMEOUT_MS : ONLINE_VOICE_START_TIMEOUT_MS,
    );

    u.onstart = () => {
      if (stale()) return;
      if (line.startTimer) clearTimeout(line.startTimer);
      line.startTimer = null;
      const now = performance.now();
      const gap = index > 0 && line.lastEndAt !== null ? now - line.lastEndAt : null;
      this.cb.onSentenceStart(line.id, index, now - calledAt, gap, line.voice);
      if (!line.started) {
        line.started = true;
        this.cb.onLineStart(line.id, now, line.requestedAt);
      }
      line.watchdog = setTimeout(() => {
        if (stale()) return;
        line.result.watchdogs++;
        this.cb.onWatchdog(line.id, index);
        this.finishSentence(line, index);
      }, utteranceWatchdogMs(text));
    };
    u.onend = () => {
      this.utterances.delete(u);
      if (stale()) return;
      this.finishSentence(line, index);
    };
    u.onerror = (e) => {
      this.utterances.delete(u);
      if (stale()) return;
      if (e.error === "interrupted" || e.error === "canceled") return;
      line.result.skipped++;
      this.finishSentence(line, index);
    };
    window.speechSynthesis.speak(u);
  }

  private onNoStart(line: Line, index: number): void {
    const synth = window.speechSynthesis;
    line.token = ++this.tokenSeq; // orphan the stuck utterance
    synth.cancel();
    if (!line.voice.localService) {
      const fallback = pickLocalFallback(this.voices, accentOf(line.voice.lang));
      this.cb.onFallback(line.voice, fallback);
      if (fallback) {
        line.voice = fallback;
        line.result.fellBack = true;
        setTimeout(() => this.speakSentence(line, index), 30);
        return;
      }
    } else {
      this.cb.onStuck(line.id, index);
    }
    line.result.skipped++;
    this.finishSentence(line, index);
  }

  private finishSentence(line: Line, index: number): void {
    if (line.done) return;
    this.clearTimers(line);
    line.lastEndAt = performance.now();
    if (index + 1 < line.sentences.length) this.speakSentence(line, index + 1);
    else this.endLine(line);
  }

  private clearTimers(line: Line): void {
    if (line.startTimer) clearTimeout(line.startTimer);
    if (line.watchdog) clearTimeout(line.watchdog);
    line.startTimer = null;
    line.watchdog = null;
  }

  private endLine(line: Line): void {
    if (line.done) return;
    line.done = true;
    if (this.line === line) this.line = null;
    this.cb.onLineEnd(line.id, line.result);
    line.resolve(line.result);
  }
}
