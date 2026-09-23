// The session engine (SPEC 8): runs an exam's Step list over the speech
// controller. Explicit state (ExamState) and phase (what the engine is doing
// right now); timing decisions come from the pure rules in endpointing.ts,
// evaluated on the controller's single tick.
//
// Turn loop: examiner line -> listening -> endpointing commits -> next line.
// Scripted lines only: no network in the loop.

import { LINES } from "../exams/ielts";
import type { CueCard, EndpointingDefaults, ExamState, Step } from "../exams/types";
import { LEVELS, type LevelId } from "../levels/levels";
import type { SayOptions, SayResult, SpeechController } from "../speech/controller";
import { countWords } from "../speech/text";
import type { AnswerOutcome, AnswerRecord, ExamCheckpoint } from "./checkpoint";
import {
  decideAnswer,
  decideMonologue,
  pauseP90,
  pickUnusedBullet,
  type AnswerTurn,
  type MonologueTurn,
} from "./endpointing";

/** The parts of the speech controller the engine uses (tests supply a fake). */
export type SpeechPort = Pick<
  SpeechController,
  | "started"
  | "start"
  | "stop"
  | "say"
  | "cancelSpeech"
  | "newTurn"
  | "currentTurn"
  | "turnText"
  | "silenceMs"
  | "voicedRecently"
  | "setMonologue"
  | "setRate"
  | "onTick"
  | "metrics"
  | "pauses"
>;

export type Phase =
  | { kind: "idle" }
  | { kind: "examiner"; stepIndex: number }
  | { kind: "listening"; stepIndex: number; turn: AnswerTurn }
  | { kind: "prep"; stepIndex: number; startedAt: number; endsAt: number }
  | { kind: "monologue"; stepIndex: number; m: MonologueTurn }
  | { kind: "done" };

interface Prefix {
  text: string;
  interruptible: boolean;
}

export interface EngineOptions {
  level: LevelId;
  defaults: EndpointingDefaults;
  save: (cp: ExamCheckpoint) => void;
  /** Epoch clock for records (tests override). */
  wallClock?: () => number;
}

export class ExamEngine {
  state: ExamState = "idle";
  phase: Phase = { kind: "idle" };
  card: CueCard | null = null;
  /** When the current state began (performance.now), for the part timer. */
  stateStartedAt = 0;
  /** The last examiner line, for "Repetir pregunta". */
  lastLine = "";

  private run = 0;
  private prefix: Prefix | null = null;
  private listeners = new Set<() => void>();
  private unTick: (() => void) | null = null;
  private readonly wall: () => number;

  constructor(
    private readonly speech: SpeechPort,
    readonly steps: Step[],
    readonly cp: ExamCheckpoint,
    private readonly opts: EngineOptions,
  ) {
    this.wall = opts.wallClock ?? Date.now;
  }

  get answers(): AnswerRecord[] {
    return this.cp.answers;
  }

  get notes(): string {
    return this.cp.notes;
  }

  setNotes(text: string): void {
    this.cp.notes = text;
    this.changed();
  }

  get currentStep(): Step | undefined {
    const i = "stepIndex" in this.phase ? this.phase.stepIndex : this.cp.nextStep;
    return this.steps[i];
  }

  /** Call from the "Empezar examen" click (the gesture that unlocks audio). */
  start(clickAt?: number): void {
    if (this.state !== "idle") return;
    this.setState("warmup", performance.now());
    this.speech.setRate(LEVELS[this.opts.level].rate);
    if (!this.speech.started) void this.speech.start();
    this.unTick = this.speech.onTick((now) => this.tick(now));
    if (this.cp.nextStep > 0) this.prefix = { text: LINES.resume, interruptible: true };
    void this.runStep(this.cp.nextStep, { clickAt });
  }

  /** "Listo" (spacebar): commit the answer now. */
  commitNow(): void {
    const now = performance.now();
    const p = this.phase;
    if (p.kind === "listening") {
      this.speech.metrics.count("space_commits");
      const hasSpeech = countWords(this.answerText(this.record(p.stepIndex))) > 0;
      this.complete(p.stepIndex, hasSpeech ? "answered" : "no-answer", now);
    } else if (p.kind === "monologue") {
      this.speech.metrics.count("space_commits");
      this.speech.setMonologue(false);
      this.complete(p.stepIndex, "answered", now, { text: LINES.thankYou, interruptible: true });
    }
  }

  /** "Repetir pregunta": replay the last line verbatim. */
  repeatLast(): void {
    const p = this.phase;
    if ((p.kind !== "listening" && p.kind !== "monologue") || !this.lastLine) return;
    const rec = this.record(p.stepIndex);
    if (rec) rec.repeats++;
    this.speech.metrics.count("repeat_button");
    void this.relisten(p.stepIndex, this.lastLine, p.kind === "listening" ? p.turn.repeated : false);
  }

  /** "Terminar": stop now and keep what exists. */
  end(): void {
    const p = this.phase;
    if (p.kind === "done") return;
    this.run++;
    this.speech.cancelSpeech();
    this.speech.setMonologue(false);
    if ("stepIndex" in p) {
      const rec = this.record(p.stepIndex);
      if (rec && rec.outcome === null) {
        rec.outcome = "ended";
        rec.committedAt = this.wall();
      }
    }
    this.finish(true);
  }

  dispose(): void {
    this.run++;
    this.unTick?.();
    this.unTick = null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** subscribe() bound to this instance, stable for React effect deps. */
  readonly subscribeBound = (fn: () => void) => this.subscribe(fn);

  /** Live text of an answer (final plus interim of its turns). */
  answerText(rec: AnswerRecord | undefined): string {
    if (!rec) return "";
    if (rec.turnIds.length === 0) return rec.text;
    return rec.turnIds
      .map((id) => this.speech.turnText(id))
      .filter(Boolean)
      .join(" ");
  }

  // ---- step runner -----------------------------------------------------------

  private async runStep(i: number, latency: { commitAt?: number; clickAt?: number } = {}): Promise<void> {
    const run = this.run;
    const step = this.steps[i];
    if (!step) {
      this.finish(false);
      return;
    }
    this.setState(step.state, performance.now());

    if (step.kind === "prep") {
      this.card = step.card;
      this.speech.newTurn("discard");
      const now = performance.now();
      this.phase = { kind: "prep", stepIndex: i, startedAt: now, endsAt: now + step.ms };
      this.changed();
      return;
    }

    const prefix = this.prefix;
    this.prefix = null;
    const text = prefix && !/^thank you/i.test(step.text) ? `${prefix.text} ${step.text}` : step.text;
    // An examiner interruption ("Thank you." at a time limit) can't be talked over.
    const interruptible = (prefix?.interruptible ?? true) && (step.kind !== "say" || step.interruptible !== false);

    if (step.kind === "say") {
      await this.speak(i, text, { ...latency, interruptible, then: "discard" });
      if (run !== this.run) return;
      await this.runStep(i + 1);
      return;
    }

    if (step.kind === "monologue") this.card = step.card;
    const rec = this.beginRecord(i, step.kind === "monologue" ? step.card.prompt : step.repeatText, step.id, step.kind === "monologue" ? 2 : step.part);
    await this.speak(i, text, { ...latency, interruptible });
    if (run !== this.run) return;
    this.addTurn(rec);
    const now = performance.now();
    if (step.kind === "monologue") {
      this.speech.setMonologue(true);
      this.phase = {
        kind: "monologue",
        stepIndex: i,
        m: { startedAt: now, listenStartedAt: now, speechStartedAt: null, backupUsed: false, startRepeated: false },
      };
    } else {
      this.phase = { kind: "listening", stepIndex: i, turn: { listenStartedAt: now, speechStartedAt: null, repeated: false } };
    }
    this.changed();
  }

  private speak(i: number, text: string, opts: SayOptions): Promise<SayResult> {
    this.phase = { kind: "examiner", stepIndex: i };
    this.lastLine = text;
    this.changed();
    return this.speech.say(text, { source: "scripted", ...opts });
  }

  /** Speak `line`, then listen again within the same step. */
  private async relisten(i: number, line: string, repeated: boolean): Promise<void> {
    const run = this.run;
    const prev = this.phase;
    await this.speak(i, line, { interruptible: true });
    if (run !== this.run) return;
    const rec = this.record(i);
    if (rec) this.addTurn(rec);
    const now = performance.now();
    if (prev.kind === "monologue") {
      this.phase = { kind: "monologue", stepIndex: i, m: { ...prev.m, listenStartedAt: now } };
    } else {
      this.phase = { kind: "listening", stepIndex: i, turn: { listenStartedAt: now, speechStartedAt: null, repeated } };
    }
    this.changed();
  }

  // ---- tick ----------------------------------------------------------------------

  tick(now: number): void {
    const p = this.phase;
    if (p.kind === "prep") {
      if (now >= p.endsAt) void this.runStep(p.stepIndex + 1);
      return;
    }
    if (p.kind === "listening") this.tickAnswer(p, now);
    else if (p.kind === "monologue") this.tickMonologue(p, now);
  }

  private tickAnswer(p: Extract<Phase, { kind: "listening" }>, now: number): void {
    const step = this.steps[p.stepIndex];
    const rec = this.record(p.stepIndex);
    if (!step || step.kind !== "ask" || !rec) return;
    const turnId = rec.turnIds[rec.turnIds.length - 1];
    const text = turnId !== undefined ? this.speech.turnText(turnId) : "";
    if (p.turn.speechStartedAt === null && countWords(text) > 0) p.turn.speechStartedAt = now;

    const action = decideAnswer(p.turn, {
      now,
      text,
      silenceMs: this.speech.silenceMs(now),
      voicedRecently: this.speech.voicedRecently(now),
      rules: step.rules,
      extraPatienceMs: LEVELS[this.opts.level].extraPatienceMs,
      defaults: this.opts.defaults,
    });
    const m = this.speech.metrics;
    switch (action.type) {
      case "wait":
        return;
      case "commit":
        this.complete(p.stepIndex, "answered", now);
        return;
      case "time-limit":
        m.count("time_limits");
        m.log("time-limit", step.id);
        this.complete(p.stepIndex, "time-limit", now, { text: LINES.thankYou, interruptible: false });
        return;
      case "repeat-request":
        rec.repeatRequests++;
        m.count("repeat_requests");
        m.log("repeat-request", `"${text}"`);
        // The request isn't part of the answer.
        rec.turnIds = rec.turnIds.filter((id) => id !== turnId);
        if (p.turn.repeated) {
          this.complete(p.stepIndex, "no-answer", now);
        } else {
          rec.repeats++;
          void this.relisten(p.stepIndex, step.repeatText, true);
        }
        return;
      case "no-speech-repeat":
        rec.repeats++;
        m.count("no_speech_repeats");
        m.log("no-speech-repeat", step.id);
        void this.relisten(p.stepIndex, step.repeatText, true);
        return;
      case "move-on":
        m.count("no_answer");
        m.log("no-answer", step.id);
        this.complete(p.stepIndex, "no-answer", now);
        return;
    }
  }

  private tickMonologue(p: Extract<Phase, { kind: "monologue" }>, now: number): void {
    const step = this.steps[p.stepIndex];
    const rec = this.record(p.stepIndex);
    if (!step || step.kind !== "monologue" || !rec) return;
    const text = this.answerText(rec);
    if (p.m.speechStartedAt === null && countWords(text) > 0) p.m.speechStartedAt = now;

    const action = decideMonologue(p.m, {
      now,
      text,
      silenceMs: this.speech.silenceMs(now),
      voicedRecently: this.speech.voicedRecently(now),
      rules: step.rules,
      noSpeechMs: this.opts.defaults.noSpeechMs,
    });
    const m = this.speech.metrics;
    switch (action.type) {
      case "wait":
        return;
      case "hard-stop":
        m.count("hard_stops");
        m.log("hard-stop", step.id);
        this.speech.setMonologue(false);
        this.complete(p.stepIndex, "hard-stop", now, { text: LINES.thankYou, interruptible: false });
        return;
      case "commit":
        this.speech.setMonologue(false);
        this.complete(p.stepIndex, "answered", now, { text: LINES.thankYou, interruptible: true });
        return;
      case "backup-prompt": {
        const bullet = pickUnusedBullet(step.card.bullets, text) ?? step.card.bullets[0] ?? "that";
        p.m.backupUsed = true;
        rec.backupPrompt = true;
        m.count("backup_prompts");
        m.log("backup-prompt", bullet);
        void this.relisten(p.stepIndex, LINES.backup(bullet), false);
        return;
      }
      case "repeat-start":
        p.m.startRepeated = true;
        rec.repeats++;
        m.count("no_speech_repeats");
        m.log("no-speech-repeat", step.id);
        void this.relisten(p.stepIndex, step.repeatText, false).then(() => {
          // The 2:00 clock starts over from the repeated instruction.
          const q = this.phase;
          if (q.kind === "monologue") q.m.startedAt = q.m.listenStartedAt;
        });
        return;
      case "move-on":
        m.count("no_answer");
        m.log("no-answer", step.id);
        this.speech.setMonologue(false);
        this.complete(p.stepIndex, "no-answer", now, { text: LINES.thankYou, interruptible: true });
        return;
    }
  }

  // ---- records -----------------------------------------------------------------

  private record(stepIndex: number): AnswerRecord | undefined {
    const step = this.steps[stepIndex];
    if (!step || step.kind === "say" || step.kind === "prep") return undefined;
    return this.cp.answers.find((a) => a.stepId === step.id);
  }

  private beginRecord(stepIndex: number, question: string, stepId: string, part: number): AnswerRecord {
    const existing = this.record(stepIndex);
    if (existing) {
      // Resumed or re-asked: keep what was said before.
      existing.outcome = null;
      existing.committedAt = null;
      return existing;
    }
    const rec: AnswerRecord = {
      stepId,
      part,
      question,
      text: "",
      askedAt: this.wall(),
      committedAt: null,
      outcome: null,
      repeats: 0,
      repeatRequests: 0,
      backupPrompt: false,
      turnIds: [],
    };
    this.cp.answers.push(rec);
    return rec;
  }

  private addTurn(rec: AnswerRecord): void {
    const turn = this.speech.currentTurn;
    if (turn.kind === "candidate" && !rec.turnIds.includes(turn.id)) rec.turnIds.push(turn.id);
  }

  /** Close the current answer and move to the next step. */
  private complete(stepIndex: number, outcome: AnswerOutcome, now: number, prefix: Prefix | null = null): void {
    const rec = this.record(stepIndex);
    if (rec) {
      rec.text = this.answerText(rec);
      rec.outcome = outcome;
      rec.committedAt = this.wall();
    }
    this.speech.metrics.log("commit", `${this.steps[stepIndex]?.kind === "monologue" ? "part 2" : "answer"}: ${outcome}`);
    this.prefix = prefix;
    this.cp.nextStep = stepIndex + 1;
    this.opts.save(this.cp);
    this.phase = { kind: "examiner", stepIndex: stepIndex + 1 };
    this.changed();
    void this.runStep(stepIndex + 1, outcome === "answered" ? { commitAt: now } : {});
  }

  private finish(endedEarly: boolean): void {
    this.run++;
    this.unTick?.();
    this.unTick = null;
    // Late final results may have arrived after each commit.
    for (const a of this.cp.answers) if (a.turnIds.length) a.text = this.answerText(a);
    this.cp.finished = true;
    this.cp.endedEarly = endedEarly;
    const p90 = pauseP90(this.speech.pauses.map((p) => p.ms));
    this.speech.metrics.setInfo("pause_p90_ms", p90);
    this.opts.save(this.cp);
    this.speech.stop();
    this.phase = { kind: "done" };
    this.setState("results", performance.now());
  }

  private setState(s: ExamState, at: number): void {
    if (this.state !== s) {
      this.state = s;
      this.stateStartedAt = at;
    }
    this.changed();
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}
