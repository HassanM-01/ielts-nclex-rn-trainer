// The session engine (SPEC 8): runs an exam's Step list over the speech
// controller. Explicit state (ExamState) and phase (what the engine is doing
// right now); timing decisions come from the pure rules in endpointing.ts and
// part3.ts, evaluated on the controller's single tick.
//
// Turn loop: examiner line -> listening -> endpointing commits -> next line.
// Scripted lines need no network. Part 3 asks the examiner model whether to
// follow up, speculatively and under a deadline, with the scripted next
// question as the fallback: the exam never waits on the network.

import { LINES } from "../exams/ielts";
import type { CueCard, EndpointingDefaults, ExamState, Step } from "../exams/types";
import { LEVELS, type LevelId } from "../levels/levels";
import type { ExaminerTurnRequest, ExchangeEntry } from "../shared/examiner-api";
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
import { withDeadline, type ExaminerOutcome, type ExaminerPort } from "./examiner-client";
import {
  canReuseSpeculative,
  followupAllowed,
  part3SecondsLeft,
  REPLY_DEADLINE_MS,
  shouldEndPart3,
  SPECULATIVE_SILENCE_MS,
} from "./part3";

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
  | "canHear"
  | "silenceDiag"
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
  | { kind: "discussion"; stepIndex: number; turn: AnswerTurn }
  | { kind: "done" };

type DiscussionStep = Extract<Step, { kind: "discussion" }>;

interface Prefix {
  text: string;
  interruptible: boolean;
}

interface Latency {
  commitAt?: number;
  clickAt?: number;
  source?: "scripted" | "ai";
}

interface Speculative {
  ctrl: AbortController;
  /** Words in the answer when it was sent. */
  words: number;
  promise: Promise<ExaminerOutcome>;
}

interface Part3State {
  step: DiscussionStep;
  startedAt: number;
  /** Listed question being answered (0-based). */
  qIndex: number;
  /** The current answer is to a follow-up. */
  onFollowup: boolean;
  followupsUsed: number;
  followupOn: Set<number>;
  /** Listed questions asked so far. */
  asked: number;
  /** Part 3 only: what goes to the examiner model. */
  exchange: ExchangeEntry[];
  recordId: string;
  /** The question being answered (listed or follow-up). */
  question: string;
  spec: Speculative | null;
}

export interface EngineOptions {
  level: LevelId;
  defaults: EndpointingDefaults;
  save: (cp: ExamCheckpoint) => void;
  /** Part 3 examiner model; without it Part 3 is fully scripted. */
  examiner?: ExaminerPort | null;
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
  private p3: Part3State | null = null;
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

  /** The answer record currently being given, if any. */
  get currentRecord(): AnswerRecord | undefined {
    return "stepIndex" in this.phase ? this.record(this.phase.stepIndex) : undefined;
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
    if (p.kind === "listening" || p.kind === "discussion") {
      this.speech.metrics.count("space_commits");
      const hasSpeech = countWords(this.answerText(this.record(p.stepIndex))) > 0;
      if (p.kind === "listening") this.complete(p.stepIndex, hasSpeech ? "answered" : "no-answer", now);
      else this.commitDiscussion(p.stepIndex, hasSpeech ? "answered" : "no-answer", now);
    } else if (p.kind === "monologue") {
      this.speech.metrics.count("space_commits");
      this.speech.setMonologue(false);
      this.complete(p.stepIndex, "answered", now, { text: LINES.thankYou, interruptible: true });
    }
  }

  /** "Repetir pregunta": replay the last line verbatim. */
  repeatLast(): void {
    const p = this.phase;
    if ((p.kind !== "listening" && p.kind !== "monologue" && p.kind !== "discussion") || !this.lastLine) return;
    const rec = this.record(p.stepIndex);
    if (rec) rec.repeats++;
    this.speech.metrics.count("repeat_button");
    this.abortSpeculative();
    void this.relisten(p.stepIndex, this.lastLine, p.kind === "monologue" ? false : p.turn.repeated);
  }

  /** "Terminar": stop now and keep what exists. */
  end(): void {
    const p = this.phase;
    if (p.kind === "done") return;
    this.run++;
    this.abortSpeculative();
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
    this.abortSpeculative();
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

  private async runStep(i: number, latency: Latency = {}): Promise<void> {
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
      // Warm an examiner function instance for Part 3 (SPEC 3.5).
      this.opts.examiner?.ping();
      const now = performance.now();
      this.phase = { kind: "prep", stepIndex: i, startedAt: now, endsAt: now + step.ms };
      this.changed();
      return;
    }

    const prefix = this.prefix;
    this.prefix = null;

    if (step.kind === "discussion") {
      await this.startDiscussion(i, step, prefix, latency);
      return;
    }

    const text = withPrefix(prefix, step.text);
    // An examiner interruption ("Thank you." at a time limit) can't be talked over.
    const interruptible = (prefix?.interruptible ?? true) && (step.kind !== "say" || step.interruptible !== false);

    if (step.kind === "say") {
      await this.speak(i, text, { ...latency, interruptible, then: "discard" });
      if (run !== this.run) return;
      await this.runStep(i + 1);
      return;
    }

    if (step.kind === "monologue") this.card = step.card;
    const rec = this.beginRecord(step.id, step.kind === "monologue" ? step.card.prompt : step.repeatText, step.kind === "monologue" ? 2 : step.part);
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
      const kind = prev.kind === "discussion" ? "discussion" : "listening";
      this.phase = { kind, stepIndex: i, turn: { listenStartedAt: now, speechStartedAt: null, repeated } };
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
    else if (p.kind === "discussion") this.tickDiscussion(p, now);
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
      hearing: this.speech.canHear,
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
        m.log("time-limit", `${step.id} (${this.speech.silenceDiag(now)})`);
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
        m.log("no-speech-repeat", `${step.id} (${this.speech.silenceDiag(now)})`);
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
      hearing: this.speech.canHear,
      rules: step.rules,
      noSpeechMs: this.opts.defaults.noSpeechMs,
    });
    const m = this.speech.metrics;
    switch (action.type) {
      case "wait":
        return;
      case "hard-stop":
        m.count("hard_stops");
        m.log("hard-stop", `${step.id} (${this.speech.silenceDiag(now)})`);
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
        m.log("backup-prompt", `${bullet} (${this.speech.silenceDiag(now)})`);
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

  // ---- Part 3 --------------------------------------------------------------------

  private async startDiscussion(i: number, step: DiscussionStep, prefix: Prefix | null, latency: Latency): Promise<void> {
    const first = Math.min(this.cp.part3Next ?? 0, step.set.questions.length);
    this.p3 = {
      step,
      startedAt: performance.now(),
      qIndex: first,
      onFollowup: false,
      followupsUsed: 0,
      followupOn: new Set(),
      asked: first,
      exchange: [],
      recordId: "",
      question: "",
      spec: null,
    };
    if (first >= step.set.questions.length) {
      await this.leaveDiscussion(i, latency);
      return;
    }
    // Scripted link sentence before the first question (or "Let's continue." on resume).
    const lead = [prefix?.text, first === 0 ? step.link : ""].filter(Boolean).join(" ");
    await this.askListed(i, first, lead, latency);
  }

  private async askListed(i: number, qi: number, lead: string, latency: Latency): Promise<void> {
    const p3 = this.p3;
    const q = p3?.step.set.questions[qi];
    if (!p3 || !q) return;
    p3.qIndex = qi;
    p3.onFollowup = false;
    p3.asked = Math.max(p3.asked, qi + 1);
    p3.recordId = `${p3.step.id}-q${qi + 1}`;
    p3.question = q.q;
    p3.exchange.push({ role: "examiner", text: q.q });
    const rec = this.beginRecord(p3.recordId, q.q, 3);
    await this.askAndListen(i, lead ? `${lead} ${q.q}` : q.q, rec, latency);
  }

  private async askFollowup(i: number, text: string, latency: Latency): Promise<void> {
    const p3 = this.p3;
    if (!p3) return;
    p3.onFollowup = true;
    p3.followupsUsed++;
    p3.followupOn.add(p3.qIndex);
    p3.recordId = `${p3.step.id}-q${p3.qIndex + 1}-f`;
    p3.question = text;
    p3.exchange.push({ role: "examiner", text });
    this.speech.metrics.count("followups");
    const rec = this.beginRecord(p3.recordId, text, 3);
    await this.askAndListen(i, text, rec, latency);
  }

  private async askAndListen(i: number, text: string, rec: AnswerRecord, latency: Latency): Promise<void> {
    const run = this.run;
    await this.speak(i, text, { ...latency, interruptible: true });
    if (run !== this.run) return;
    this.addTurn(rec);
    this.phase = { kind: "discussion", stepIndex: i, turn: { listenStartedAt: performance.now(), speechStartedAt: null, repeated: false } };
    this.changed();
  }

  private tickDiscussion(p: Extract<Phase, { kind: "discussion" }>, now: number): void {
    const p3 = this.p3;
    const rec = this.record(p.stepIndex);
    if (!p3 || !rec) return;
    const turnId = rec.turnIds[rec.turnIds.length - 1];
    const text = turnId !== undefined ? this.speech.turnText(turnId) : "";
    if (p.turn.speechStartedAt === null && countWords(text) > 0) p.turn.speechStartedAt = now;
    const silenceMs = this.speech.silenceMs(now);
    this.speculate(p, this.answerText(rec), Math.min(silenceMs, now - p.turn.listenStartedAt));

    const action = decideAnswer(p.turn, {
      now,
      text,
      silenceMs,
      voicedRecently: this.speech.voicedRecently(now),
      hearing: this.speech.canHear,
      rules: p3.step.rules.answer,
      extraPatienceMs: LEVELS[this.opts.level].extraPatienceMs,
      defaults: this.opts.defaults,
    });
    const m = this.speech.metrics;
    // Listed questions are repeated with the bank's rephrase; follow-ups verbatim.
    const repeatLine = p3.onFollowup ? p3.question : (p3.step.set.questions[p3.qIndex]?.rephrase ?? p3.question);
    switch (action.type) {
      case "wait":
        return;
      case "commit":
        this.commitDiscussion(p.stepIndex, "answered", now);
        return;
      case "time-limit":
        this.commitDiscussion(p.stepIndex, "time-limit", now);
        return;
      case "repeat-request":
        rec.repeatRequests++;
        m.count("repeat_requests");
        m.log("repeat-request", `"${text}"`);
        rec.turnIds = rec.turnIds.filter((id) => id !== turnId);
        this.abortSpeculative();
        if (p.turn.repeated) {
          this.commitDiscussion(p.stepIndex, "no-answer", now);
        } else {
          rec.repeats++;
          void this.relisten(p.stepIndex, repeatLine, true);
        }
        return;
      case "no-speech-repeat":
        rec.repeats++;
        m.count("no_speech_repeats");
        m.log("no-speech-repeat", `${p3.recordId} (${this.speech.silenceDiag(now)})`);
        this.abortSpeculative();
        void this.relisten(p.stepIndex, repeatLine, true);
        return;
      case "move-on":
        m.count("no_answer");
        m.log("no-answer", p3.recordId);
        this.commitDiscussion(p.stepIndex, "no-answer", now);
        return;
    }
  }

  /** May the model ask a follow-up to the current answer? */
  private followupPossible(): boolean {
    const p3 = this.p3;
    if (!p3 || !this.opts.examiner || p3.onFollowup) return false;
    return followupAllowed(LEVELS[this.opts.level].part3Followups, p3.qIndex, p3.followupsUsed, p3.followupOn.has(p3.qIndex));
  }

  /**
   * SPEC 3.2 / 8: after 1.0 s of silence, send the answer so far; cancel if
   * Julio keeps talking. By the time the turn commits the reply is usually in.
   */
  private speculate(p: Extract<Phase, { kind: "discussion" }>, answer: string, silenceMs: number): void {
    const p3 = this.p3;
    const ex = this.opts.examiner;
    if (!p3 || !ex || !this.followupPossible()) return;
    if (p3.spec) {
      if (silenceMs < SPECULATIVE_SILENCE_MS) {
        this.abortSpeculative();
        this.speech.metrics.count("spec_aborted");
      }
      return;
    }
    const words = countWords(answer);
    if (words === 0 || p.turn.speechStartedAt === null || silenceMs < SPECULATIVE_SILENCE_MS) return;
    const ctrl = new AbortController();
    p3.spec = { ctrl, words, promise: ex.request(this.turnRequest(answer, performance.now()), ctrl.signal) };
    this.speech.metrics.count("spec_fired");
  }

  private abortSpeculative(): void {
    const p3 = this.p3;
    if (p3?.spec) {
      p3.spec.ctrl.abort();
      p3.spec = null;
    }
  }

  private turnRequest(answer: string, now: number): ExaminerTurnRequest {
    const p3 = this.p3!;
    return {
      kind: "turn",
      part2Prompt: p3.step.part2Prompt,
      questions: p3.step.set.questions.map((q) => q.q),
      index: p3.qIndex,
      exchange: [...p3.exchange, { role: "candidate" as const, text: answer }].slice(-20),
      secondsLeft: part3SecondsLeft(now - p3.startedAt, p3.step.rules),
      followupsUsed: p3.followupsUsed,
      allowance: LEVELS[this.opts.level].part3Followups,
    };
  }

  private commitDiscussion(i: number, outcome: AnswerOutcome, now: number): void {
    const p3 = this.p3;
    if (!p3) return;
    const rec = this.record(i);
    const answer = rec ? this.answerText(rec) : "";
    if (rec) {
      rec.text = answer;
      rec.outcome = outcome;
      rec.committedAt = this.wall();
    }
    this.logCommit(rec, outcome);
    p3.exchange.push({ role: "candidate", text: answer });
    this.cp.part3Next = p3.qIndex + 1;
    this.opts.save(this.cp);
    this.phase = { kind: "examiner", stepIndex: i };
    this.changed();
    void this.afterDiscussionAnswer(i, outcome, now, answer);
  }

  private async afterDiscussionAnswer(i: number, outcome: AnswerOutcome, commitAt: number, answer: string): Promise<void> {
    const run = this.run;
    const p3 = this.p3;
    const ex = this.opts.examiner;
    if (!p3) return;
    const m = this.speech.metrics;
    const elapsed = commitAt - p3.startedAt;

    // The engine owns timing: past 4:30 with 4+ listed questions, close.
    if (shouldEndPart3(elapsed, p3.asked, p3.step.rules)) {
      this.abortSpeculative();
      m.log("part3-end", `${Math.round(elapsed / 1000)} s, ${p3.asked} questions`);
      await this.leaveDiscussion(i, { commitAt });
      return;
    }
    if (outcome !== "answered" || !ex || !this.followupPossible()) {
      this.abortSpeculative();
      await this.nextListed(i, outcome === "answered" ? { commitAt } : {});
      return;
    }

    // Reuse the speculative reply if the answer grew by 3 words or fewer;
    // otherwise ask again. Either way: 1.2 s deadline, then scripted.
    const spec = p3.spec;
    p3.spec = null;
    let ctrl: AbortController;
    let pending: Promise<ExaminerOutcome>;
    if (spec && canReuseSpeculative(spec.words, countWords(answer))) {
      ctrl = spec.ctrl;
      pending = spec.promise;
      m.count("spec_reused");
    } else {
      if (spec) {
        spec.ctrl.abort();
        m.count("spec_discarded");
      }
      ctrl = new AbortController();
      pending = ex.request(this.turnRequest(answer, commitAt), ctrl.signal);
    }
    const remaining = Math.max(0, REPLY_DEADLINE_MS - (performance.now() - commitAt));
    const result = await withDeadline(pending, remaining, () => ctrl.abort());
    if (run !== this.run) return;

    m.setInfo("examiner_calls", ex.calls);
    if (result.ok) {
      m.record("examiner_reply", result.ms);
      m.log("ai-reply", `${result.reply.type}${result.reply.type === "followup" ? `: "${result.reply.text}"` : ""} (${Math.round(result.ms)} ms)`);
    } else {
      m.count("examiner_fallbacks");
      m.count(`examiner_fallback:${result.reason}`);
      m.log("ai-fallback", result.reason);
    }
    const latency: Latency = { commitAt, source: "ai" };
    const reply = result.ok ? result.reply : null;
    if (reply?.type === "followup") await this.askFollowup(i, reply.text, latency);
    else if (reply?.type === "end") await this.leaveDiscussion(i, latency);
    else await this.nextListed(i, latency);
  }

  private async nextListed(i: number, latency: Latency): Promise<void> {
    const p3 = this.p3;
    if (!p3) return;
    const next = p3.qIndex + 1;
    if (next < p3.step.set.questions.length) await this.askListed(i, next, "", latency);
    else await this.leaveDiscussion(i, latency);
  }

  private async leaveDiscussion(i: number, latency: Latency): Promise<void> {
    this.abortSpeculative();
    delete this.cp.part3Next;
    this.cp.nextStep = i + 1;
    this.opts.save(this.cp);
    await this.runStep(i + 1, latency);
  }

  // ---- records -----------------------------------------------------------------

  private record(stepIndex: number): AnswerRecord | undefined {
    const step = this.steps[stepIndex];
    if (!step || step.kind === "say" || step.kind === "prep") return undefined;
    const id = step.kind === "discussion" ? this.p3?.recordId : step.id;
    return id ? this.cp.answers.find((a) => a.stepId === id) : undefined;
  }

  private beginRecord(stepId: string, question: string, part: number): AnswerRecord {
    const existing = this.cp.answers.find((a) => a.stepId === stepId);
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

  private logCommit(rec: AnswerRecord | undefined, outcome: AnswerOutcome): void {
    const words = (rec?.text ?? "").split(/\s+/).filter(Boolean);
    const snippet = words.length > 8 ? `${words.slice(0, 8).join(" ")}… (${words.length} words)` : words.join(" ");
    this.speech.metrics.log("commit", `${rec?.stepId ?? "?"} ${outcome}: "${snippet}"`);
  }

  /** Close the current answer and move to the next step. */
  private complete(stepIndex: number, outcome: AnswerOutcome, now: number, prefix: Prefix | null = null): void {
    const rec = this.record(stepIndex);
    if (rec) {
      rec.text = this.answerText(rec);
      rec.outcome = outcome;
      rec.committedAt = this.wall();
    }
    this.logCommit(rec, outcome);
    this.prefix = prefix;
    this.cp.nextStep = stepIndex + 1;
    this.opts.save(this.cp);
    this.phase = { kind: "examiner", stepIndex: stepIndex + 1 };
    this.changed();
    void this.runStep(stepIndex + 1, outcome === "answered" ? { commitAt: now } : {});
  }

  private finish(endedEarly: boolean): void {
    this.run++;
    this.abortSpeculative();
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

function withPrefix(prefix: Prefix | null, text: string): string {
  return prefix && !/^thank you/i.test(text) ? `${prefix.text} ${text}` : text;
}
