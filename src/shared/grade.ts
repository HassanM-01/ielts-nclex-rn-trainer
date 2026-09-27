// Contract between the browser and /api/grade (SPEC 11). Types, limits and
// small pure functions only: both sides import this, and nothing here pulls
// in server code or the SDK.

import { NCLEX_AREAS, type NclexArea } from "../exams/bank";
import type { LevelId } from "../levels/levels";

// ---- request -----------------------------------------------------------------

export type GradeMode = "full" | "part1" | "parts23" | "quick";

/** Per-answer fluency numbers (SPEC 11 "per-turn metrics"). */
export interface AnswerMetrics {
  /** From his first recognized word to his last (ms). */
  speakingMs: number;
  words: number;
  pausesOver1s: number;
  pausesOver2s: number;
  /** From the end of the question to his first recognized word (ms), or null. */
  firstWordMs: number | null;
}

export interface GradeAnswer {
  /** 0 = opening, 1 to 3 = the parts. */
  part: number;
  question: string;
  text: string;
  /** "answered", "no-answer", "time-limit", "hard-stop" or "ended". */
  outcome: string;
  /** The answer is to a Part 3 follow-up. */
  followup: boolean;
  metrics: AnswerMetrics | null;
}

export interface GradeRequest {
  kind: "grade";
  mode: GradeMode;
  /** Feedback level: sets the upgraded-answer band and the advice focus. */
  level: LevelId;
  /** Not a full test (partial practice modes, or ended early). */
  partial: boolean;
  answers: GradeAnswer[];
  /** Saved words due for review (from step 6). */
  savedWords: string[];
  /** Questions he opened "Ayuda" on (from step 7). */
  ayuda: string[];
  /** Average recognizer confidence, or null when the browser reports none. */
  avgConfidence: number | null;
}

export const GRADE_LIMITS = {
  answers: 40,
  questionChars: 600,
  answerChars: 6_000,
  savedWords: 30,
  wordChars: 60,
  bodyBytes: 200_000,
} as const;

/** Below this many words in all answers, grading isn't worth a model call. */
export const MIN_WORDS_TO_GRADE = 30;

// ---- the model's output (SPEC 11 schema, in this order) ------------------------

export const CRITERIA = ["fluency_coherence", "lexical_resource", "grammatical_range"] as const;
export type CriterionKey = (typeof CRITERIA)[number];

export interface Criterion {
  evidence: string[];
  band: number;
  advice_es: string;
}

export interface Flagged {
  heard: string;
  likely: string;
}

export interface UpgradedAnswer {
  part: number;
  question: string;
  original: string;
  better: string;
  why_es: string;
}

export type VocabExam = "ielts" | "nclex" | "both";

export interface VocabItem {
  word: string;
  es: string;
  example: string;
  exam: VocabExam;
  nclex_area: NclexArea | "none";
}

export interface Grade {
  fluency_coherence: Criterion;
  lexical_resource: Criterion;
  grammatical_range: Criterion;
  pronunciation_proxy: { flagged: Flagged[]; note_es: string };
  top_fixes_es: string[];
  next_focus_es: string;
  upgraded_answers: UpgradedAnswer[];
  saved_words_used: string[];
  vocab_to_learn: VocabItem[];
}

/** Top-level keys in schema (and stream) order. */
export const GRADE_KEYS = [
  "fluency_coherence",
  "lexical_resource",
  "grammatical_range",
  "pronunciation_proxy",
  "top_fixes_es",
  "next_focus_es",
  "upgraded_answers",
  "saved_words_used",
  "vocab_to_learn",
] as const satisfies readonly (keyof Grade)[];

export type GradeKey = (typeof GRADE_KEYS)[number];

// ---- the stream from /api/grade -------------------------------------------------

/**
 * /api/grade streams newline-delimited JSON events:
 * - "delta": the next piece of the model's JSON text;
 * - "reset": the first attempt failed and a retry starts (drop the text so far);
 * - "done": the final, validated grade;
 * - "error": grading failed (after the retry).
 */
export type GradeEvent =
  | { t: "delta"; v: string }
  | { t: "reset" }
  | { t: "done"; grade: Grade; usage: GradeUsage }
  | { t: "error"; code: GradeErrorCode };

export type GradeErrorCode = "upstream" | "refusal" | "incomplete";

/** Tokens billed for the grade, all attempts included (for the cost log). */
export interface GradeUsage {
  input: number;
  output: number;
}

// ---- pure helpers ----------------------------------------------------------------

/**
 * SPEC 11: the overall is computed in code: the mean of the three graded
 * criteria, rounded DOWN to the nearest half band.
 */
export function overallBand(bands: readonly number[]): number | null {
  if (bands.length === 0) return null;
  const mean = bands.reduce((a, b) => a + b, 0) / bands.length;
  // The epsilon keeps 6.5 computed as 6.4999999 from dropping to 6.0.
  return Math.floor(mean * 2 + 1e-9) / 2;
}

export function gradeOverall(g: Pick<Grade, CriterionKey>): number {
  return overallBand(CRITERIA.map((k) => g[k].band)) ?? 0;
}

function obj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function str(x: unknown): string | null {
  return typeof x === "string" ? x.trim() : null;
}

/** A list of strings (empty ones dropped), or null. */
export function strings(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  const out = x.map(str);
  return out.every((s): s is string => s !== null) ? out.filter(Boolean) : null;
}

const QUOTES = `"'“”‘’«»`;

/** The screen adds quotation marks to evidence, so drop the model's own. */
export function unquote(s: string): string {
  let out = s.trim();
  while (out.length >= 2 && QUOTES.includes(out[0]!) && QUOTES.includes(out[out.length - 1]!)) out = out.slice(1, -1).trim();
  return out;
}

/** One criterion object (also used on a closed criterion while the stream is still arriving). */
export function normalizeCriterion(x: unknown): Criterion | null {
  const o = obj(x);
  if (!o) return null;
  const evidence = strings(o.evidence);
  const advice = str(o.advice_es);
  const band = typeof o.band === "number" && Number.isFinite(o.band) ? o.band : null;
  if (!evidence || advice === null || band === null) return null;
  // Whole bands 0 to 9 (SPEC 11); a stray half band rounds down, never up.
  return { evidence: evidence.map(unquote).filter(Boolean), band: Math.min(9, Math.max(0, Math.floor(band))), advice_es: advice };
}

const EXAMS: VocabExam[] = ["ielts", "nclex", "both"];

/** Compare enum values case-insensitively (SPEC 11). */
function pick<T extends string>(x: unknown, allowed: readonly T[]): T | null {
  const s = str(x)?.toLowerCase();
  return allowed.find((a) => a.toLowerCase() === s) ?? null;
}

/**
 * Checks a parsed grade and normalizes it (bands clamped to whole 0 to 9,
 * enums matched case-insensitively, items with missing fields dropped).
 * Returns null if a required part is missing or malformed.
 */
export function normalizeGrade(x: unknown): Grade | null {
  const o = obj(x);
  if (!o) return null;
  const fc = normalizeCriterion(o.fluency_coherence);
  const lr = normalizeCriterion(o.lexical_resource);
  const gr = normalizeCriterion(o.grammatical_range);
  const pp = obj(o.pronunciation_proxy);
  const fixes = strings(o.top_fixes_es);
  const focus = str(o.next_focus_es);
  const used = strings(o.saved_words_used);
  if (!fc || !lr || !gr || !pp || !fixes || focus === null || !used) return null;
  if (!Array.isArray(pp.flagged) || !Array.isArray(o.upgraded_answers) || !Array.isArray(o.vocab_to_learn)) return null;

  const flagged = pp.flagged.flatMap((f): Flagged[] => {
    const fo = obj(f);
    const heard = str(fo?.heard);
    const likely = str(fo?.likely);
    return heard && likely ? [{ heard, likely }] : [];
  });
  const upgraded = o.upgraded_answers.flatMap((u): UpgradedAnswer[] => {
    const uo = obj(u);
    if (!uo) return [];
    const question = str(uo.question);
    const original = str(uo.original);
    const better = str(uo.better);
    const why = str(uo.why_es);
    const part = typeof uo.part === "number" ? Math.round(uo.part) : null;
    return question && original !== null && better && why !== null && part !== null ? [{ part, question, original, better, why_es: why }] : [];
  });
  const vocab = o.vocab_to_learn.flatMap((v): VocabItem[] => {
    const vo = obj(v);
    const word = str(vo?.word);
    const es = str(vo?.es);
    const example = str(vo?.example);
    if (!word || !es || example === null) return [];
    const exam = pick(vo?.exam, EXAMS) ?? "ielts";
    const area = pick(vo?.nclex_area, NCLEX_AREAS) ?? "none";
    return [{ word, es, example, exam, nclex_area: area }];
  });

  return {
    fluency_coherence: fc,
    lexical_resource: lr,
    grammatical_range: gr,
    pronunciation_proxy: { flagged, note_es: str(pp.note_es) ?? "" },
    top_fixes_es: fixes.slice(0, 3),
    next_focus_es: focus,
    upgraded_answers: upgraded.slice(0, 2),
    saved_words_used: used,
    vocab_to_learn: vocab,
  };
}
