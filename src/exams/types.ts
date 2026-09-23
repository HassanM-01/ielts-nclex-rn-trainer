// Exam definitions: data plus small pure functions. The session engine runs
// any exam that compiles to a list of Steps, so Clinical mode and a future
// TOEFL mode reuse it.

export type ExamId = "ielts" | "clinical" | "toefl";

/** Engine states. IELTS uses these; other exams use the subset they need. */
export type ExamState =
  | "idle"
  | "warmup"
  | "opening"
  | "part1"
  | "part2_prep"
  | "part2_speak"
  | "part2_roundoff"
  | "part3"
  | "closing"
  | "grading"
  | "results";

/** How a normal question-and-answer turn is endpointed. */
export interface AnswerRules {
  /** Silence that commits an answer (before extensions). */
  baseSilenceMs: number;
  /** Examiner cuts in after this much speaking (Part 1: about 40 s); null = never. */
  maxAnswerMs: number | null;
}

/** Part 2 long-turn timing. */
export interface MonologueRules {
  hardStopMs: number;
  goalMs: number;
  /** Before the goal, this much silence triggers the one back-up prompt. */
  backupSilenceMs: number;
  /** After the goal or the back-up prompt, this much silence ends the turn. */
  endSilenceMs: number;
}

export interface CueCard {
  id: string;
  prompt: string;
  bullets: string[];
  explain: string;
  roundoff: string[];
}

export type Step =
  /** Examiner line with no answer expected. */
  | { kind: "say"; state: ExamState; text: string; interruptible?: boolean }
  /** Examiner question; `repeatText` is what a repeat says (the question alone, verbatim). */
  | { kind: "ask"; state: ExamState; id: string; part: number; text: string; repeatText: string; rules: AnswerRules }
  /** Part 2 preparation: cue card and notes, then a countdown. */
  | { kind: "prep"; state: ExamState; card: CueCard; ms: number }
  /** Part 2 long turn. */
  | { kind: "monologue"; state: ExamState; id: string; card: CueCard; text: string; repeatText: string; rules: MonologueRules };

/** Endpointing values an exam supplies to the engine (SPEC 8). */
export interface EndpointingDefaults {
  /** No speech at all after this long: repeat once, then move on. */
  noSpeechMs: number;
  /** Added when the answer ends on a continuation cue or is under `shortAnswerWords`. */
  continuationExtraMs: number;
  shortAnswerWords: number;
}
