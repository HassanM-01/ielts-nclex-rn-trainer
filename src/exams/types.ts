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

export interface HelpPhrase {
  en: string;
  es: string;
}

export interface Part3Question {
  q: string;
  /** concrete: people's own experience or their country; abstract: causes, comparisons, the future, society. */
  kind: "concrete" | "abstract";
  /** Said instead of a verbatim repeat when Julio asks. */
  rephrase: string;
  /** Pre-written follow-ups, for when the model call fails. */
  followups: string[];
  help?: HelpPhrase[];
}

export interface Part3Set {
  id: string;
  theme: string;
  questions: Part3Question[];
}

/** Part 3 timing (SPEC 8: the engine owns timing, not the model). */
export interface DiscussionRules {
  answer: AnswerRules;
  /** Part 3 ends after the first answer that finishes past this... */
  endAfterMs: number;
  /** ...once at least this many listed questions were asked. */
  minQuestions: number;
  /** Nominal length, for "seconds left" in the examiner request. */
  lengthMs: number;
  /** The model may only end Part 3 with less than this left. */
  endAllowedUnderMs: number;
}

export type Step =
  /** Examiner line with no answer expected. */
  | { kind: "say"; state: ExamState; text: string; interruptible?: boolean }
  /** Examiner question; `repeatText` is what a repeat says (the question alone, verbatim). */
  | { kind: "ask"; state: ExamState; id: string; part: number; text: string; repeatText: string; rules: AnswerRules }
  /** Part 2 preparation: cue card and notes, then a countdown. */
  | { kind: "prep"; state: ExamState; card: CueCard; ms: number }
  /** Part 2 long turn. */
  | { kind: "monologue"; state: ExamState; id: string; card: CueCard; text: string; repeatText: string; rules: MonologueRules }
  /** Part 3: listed questions, with model-chosen follow-ups. `link` is spoken before the first question. */
  | { kind: "discussion"; state: ExamState; id: string; set: Part3Set; part2Prompt: string; link: string; rules: DiscussionRules };

/** Endpointing values an exam supplies to the engine (SPEC 8). */
export interface EndpointingDefaults {
  /** No speech at all after this long: repeat once, then move on. */
  noSpeechMs: number;
  /** Added when the answer ends on a continuation cue or is under `shortAnswerWords`. */
  continuationExtraMs: number;
  shortAnswerWords: number;
}
