// "Reintentar" (SPEC 13): the examiner re-asks one question, Julio answers
// again (endpointed like the real part), and EXAMINER_MODEL compares the two
// attempts in two lines of Spanish. Runs on the same speech controller as
// the exam; the click on "Reintentar" is the gesture that unlocks audio.

import { IELTS_ENDPOINTING, PART1_RULES, PART3_RULES } from "../exams/ielts";
import type { AnswerRules } from "../exams/types";
import type { ExaminerCompareRequest } from "../shared/examiner-api";
import type { SpeechController } from "../speech/controller";
import { countWords } from "../speech/text";
import { decideAnswer, type AnswerTurn } from "../session/endpointing";
import { getToken } from "../session/token-client";

export type RetrySpeech = Pick<
  SpeechController,
  "started" | "start" | "stop" | "say" | "cancelSpeech" | "currentTurn" | "turnText" | "silenceMs" | "voicedRecently" | "canHear" | "onTick"
>;

/** Part 2 answers get the long-turn end silence and the 2:00 limit. */
const PART2_RETRY_RULES: AnswerRules = { baseSilenceMs: 6_000, maxAnswerMs: 120_000 };
/** A Part 3 answer has no time limit in the exam; here it stops at 2 minutes. */
const PART3_RETRY_RULES: AnswerRules = { ...PART3_RULES, maxAnswerMs: 120_000 };

export function retryRules(part: number): AnswerRules {
  return part === 1 ? PART1_RULES : part === 2 ? PART2_RETRY_RULES : PART3_RETRY_RULES;
}

export type RetryPhase = "speaking" | "listening" | "done";

export class RetryAttempt {
  phase: RetryPhase = "speaking";
  private turnIds: number[] = [];
  private turn: AnswerTurn | null = null;
  private unTick: (() => void) | null = null;
  private resolve: ((text: string) => void) | null = null;
  private asked = 0;
  private stopped = false;

  constructor(
    private readonly speech: RetrySpeech,
    readonly question: string,
    readonly part: number,
    private readonly extraPatienceMs = 0,
    private readonly onChange: () => void = () => {},
  ) {}

  /** Asks the question and resolves with his new answer. */
  run(): Promise<string> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      void (async () => {
        if (!this.speech.started) await this.speech.start();
        this.unTick = this.speech.onTick((now) => this.tick(now));
        await this.ask();
      })();
    });
  }

  /** His answer so far. */
  get text(): string {
    return this.turnIds
      .map((id) => this.speech.turnText(id))
      .filter(Boolean)
      .join(" ");
  }

  /** "Listo": commit now. */
  commitNow(): void {
    if (this.phase === "listening") this.finish();
  }

  cancel(): void {
    this.speech.cancelSpeech();
    this.finish();
  }

  private async ask(): Promise<void> {
    this.asked++;
    this.phase = "speaking";
    this.onChange();
    await this.speech.say(this.question, { source: "scripted", interruptible: true });
    if (this.stopped) return;
    const t = this.speech.currentTurn;
    if (t.kind === "candidate" && !this.turnIds.includes(t.id)) this.turnIds.push(t.id);
    this.turn = { listenStartedAt: performance.now(), speechStartedAt: null, repeated: this.asked > 1 };
    this.phase = "listening";
    this.onChange();
  }

  private tick(now: number): void {
    const turn = this.turn;
    if (this.phase !== "listening" || !turn) return;
    const id = this.turnIds[this.turnIds.length - 1];
    const text = id === undefined ? "" : this.speech.turnText(id);
    if (turn.speechStartedAt === null && countWords(text) > 0) turn.speechStartedAt = now;
    const action = decideAnswer(turn, {
      now,
      text,
      silenceMs: this.speech.silenceMs(now),
      voicedRecently: this.speech.voicedRecently(now),
      hearing: this.speech.canHear,
      rules: retryRules(this.part),
      extraPatienceMs: this.extraPatienceMs,
      defaults: IELTS_ENDPOINTING,
    });
    this.onChange();
    switch (action.type) {
      case "wait":
        return;
      case "repeat-request":
      case "no-speech-repeat":
        if (action.type === "repeat-request") this.turnIds = this.turnIds.filter((t) => t !== id);
        if (this.asked < 2) void this.ask();
        else this.finish();
        return;
      default:
        this.finish();
    }
  }

  private finish(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.phase = "done";
    this.unTick?.();
    this.unTick = null;
    const text = this.text;
    this.speech.stop();
    this.onChange();
    this.resolve?.(text);
  }
}

// ---- the comparison ----------------------------------------------------------------

/** A comparison is two short lines; this is generous. */
const COMPARE_TIMEOUT_MS = 20_000;
/** Client guard: comparisons per page load. */
const COMPARE_CAP = 10;
let compares = 0;

export type CompareResult = { ok: true; text: string } | { ok: false };

export async function compareAttempts(body: Omit<ExaminerCompareRequest, "kind">, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<CompareResult> {
  if (compares >= COMPARE_CAP) return { ok: false };
  const token = await getToken();
  if (!token) return { ok: false };
  compares++;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), COMPARE_TIMEOUT_MS);
  try {
    const res = await fetchImpl("/api/examiner", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind: "compare", ...body } satisfies ExaminerCompareRequest),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false };
    const text = (await res.text()).trim();
    return text ? { ok: true, text } : { ok: false };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Tests only. */
export function resetCompareCap(): void {
  compares = 0;
}
