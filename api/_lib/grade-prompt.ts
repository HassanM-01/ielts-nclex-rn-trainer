// /api/grade input validation, the output schema and the prompt (SPEC 11).
// The browser's copy of the contract is src/shared/grade.ts; this file keeps
// its own copies of the limits so no browser code runs on the server.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod/v4";
import type { GradeAnswer, GradeMode, GradeRequest } from "../../src/shared/grade";

const LIMITS = { answers: 40, questionChars: 600, answerChars: 6_000, savedWords: 30, wordChars: 60 };
const MODES: GradeMode[] = ["full", "part1", "parts23", "quick"];
const OUTCOMES = ["answered", "no-answer", "time-limit", "hard-stop", "ended"];

const NCLEX_AREAS = [
  "Management of Care",
  "Safety and Infection Prevention and Control",
  "Health Promotion and Maintenance",
  "Psychosocial Integrity",
  "Basic Care and Comfort",
  "Pharmacological and Parenteral Therapies",
  "Reduction of Risk Potential",
  "Physiological Adaptation",
] as const;

// ---- output schema (SPEC 11; order matters: evidence before band) ---------------

const Criterion = z.object({
  evidence: z.array(z.string()),
  band: z.number().int().min(0).max(9),
  advice_es: z.string(),
});

export const GradeOutput = z.object({
  fluency_coherence: Criterion,
  lexical_resource: Criterion,
  grammatical_range: Criterion,
  pronunciation_proxy: z.object({
    flagged: z.array(z.object({ heard: z.string(), likely: z.string() })),
    note_es: z.string(),
  }),
  top_fixes_es: z.array(z.string()),
  next_focus_es: z.string(),
  upgraded_answers: z.array(
    z.object({ part: z.number().int().min(1).max(3), question: z.string(), original: z.string(), better: z.string(), why_es: z.string() }),
  ),
  saved_words_used: z.array(z.string()),
  vocab_to_learn: z.array(
    z.object({
      word: z.string(),
      es: z.string(),
      example: z.string(),
      exam: z.enum(["ielts", "nclex", "both"]),
      nclex_area: z.enum([...NCLEX_AREAS, "none"]),
    }),
  ),
});

export type GradeOutputType = z.infer<typeof GradeOutput>;

// ---- input ---------------------------------------------------------------------

function isStr(x: unknown, max: number, allowEmpty = false): x is string {
  return typeof x === "string" && (allowEmpty || x.length > 0) && x.length <= max;
}

function nonNeg(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}

function parseAnswer(x: unknown): GradeAnswer | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Record<string, unknown>;
  if (typeof a.part !== "number" || ![1, 2, 3].includes(a.part)) return null;
  if (!isStr(a.question, LIMITS.questionChars) || !isStr(a.text, LIMITS.answerChars, true)) return null;
  if (typeof a.outcome !== "string" || !OUTCOMES.includes(a.outcome)) return null;
  let metrics: GradeAnswer["metrics"] = null;
  if (a.metrics !== null) {
    const m = a.metrics as Record<string, unknown> | undefined;
    if (!m || typeof m !== "object") return null;
    if (![m.speakingMs, m.words, m.pausesOver1s, m.pausesOver2s].every(nonNeg)) return null;
    if (m.firstWordMs !== null && !nonNeg(m.firstWordMs)) return null;
    metrics = {
      speakingMs: m.speakingMs as number,
      words: m.words as number,
      pausesOver1s: m.pausesOver1s as number,
      pausesOver2s: m.pausesOver2s as number,
      firstWordMs: m.firstWordMs as number | null,
    };
  }
  return { part: a.part, question: a.question, text: a.text, outcome: a.outcome, followup: a.followup === true, metrics };
}

function parseWords(x: unknown, maxItems: number, maxChars: number): string[] | null {
  if (!Array.isArray(x) || x.length > maxItems) return null;
  return x.every((w) => isStr(w, maxChars)) ? (x as string[]) : null;
}

export function parseGradeRequest(body: unknown): GradeRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.kind !== "grade") return null;
  if (typeof b.mode !== "string" || !MODES.includes(b.mode as GradeMode)) return null;
  if (b.level !== 1 && b.level !== 2 && b.level !== 3) return null;
  if (typeof b.partial !== "boolean") return null;
  if (!Array.isArray(b.answers) || b.answers.length === 0 || b.answers.length > LIMITS.answers) return null;
  const answers = b.answers.map(parseAnswer);
  if (answers.some((a) => a === null)) return null;
  const savedWords = parseWords(b.savedWords, LIMITS.savedWords, LIMITS.wordChars);
  const ayuda = parseWords(b.ayuda, LIMITS.answers, LIMITS.questionChars);
  if (!savedWords || !ayuda) return null;
  const conf = b.avgConfidence;
  if (conf !== null && !(typeof conf === "number" && conf >= 0 && conf <= 1)) return null;
  return {
    kind: "grade",
    mode: b.mode as GradeMode,
    level: b.level,
    partial: b.partial,
    answers: answers as GradeAnswer[],
    savedWords,
    ayuda,
    avgConfidence: conf,
  };
}

// ---- prompt --------------------------------------------------------------------

let systemPrompt: string | null = null;

/** The grading instructions plus the official descriptors, loaded once per instance. */
export function gradeSystemPrompt(): string {
  if (systemPrompt === null) {
    const dir = join(process.cwd(), "api", "prompts");
    const rules = readFileSync(join(dir, "grade-ielts.md"), "utf8").trim();
    const descriptors = readFileSync(join(dir, "ielts-descriptors.md"), "utf8").trim();
    systemPrompt = `${rules}\n\n---\n\n${descriptors}`;
  }
  return systemPrompt;
}

/** SPEC 7: what the upgraded answers aim at, and what the advice focuses on, by level. */
const LEVEL_TEXT: Record<1 | 2 | 3, { name: string; band: string; focus: string }> = {
  1: { name: "Nivel 1 (B1 to B2)", band: "6", focus: "answering at length, linking ideas, and basic accuracy" },
  2: { name: "Nivel 2 (B2 to C1)", band: "7", focus: "range: less common vocabulary, complex sentences, fewer repetitions" },
  3: {
    name: "Nivel 3 (real exam)",
    band: "7.5",
    focus: "the band 7 descriptors: flexible, precise vocabulary, idiomatic language, mostly error-free complex sentences",
  },
};

const MODE_TEXT: Record<GradeMode, string> = {
  full: "full test (Parts 1, 2 and 3)",
  part1: "partial practice: Part 1 only",
  parts23: "partial practice: Parts 2 and 3",
  quick: "partial practice: one Part 2 card and two Part 3 questions",
};

const OUTCOME_NOTE: Record<string, string> = {
  "no-answer": "no answer",
  "time-limit": "the examiner stopped him at the time limit",
  "hard-stop": "the 2-minute limit was reached",
  ended: "he ended the test here",
};

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function metricsLine(a: GradeAnswer): string {
  const m = a.metrics;
  if (!m || m.words === 0) return "";
  const wpm = m.speakingMs >= 5_000 ? `, ${Math.round(m.words / (m.speakingMs / 60_000))} words per minute` : "";
  const start = m.firstWordMs === null ? "" : `, started after ${secs(m.firstWordMs)}`;
  return `[${secs(m.speakingMs)} speaking, ${m.words} words${wpm}, pauses over 1 s: ${m.pausesOver1s}, over 2 s: ${m.pausesOver2s}${start}]`;
}

/** The user message: session facts, then the transcript by part with per-answer metrics. */
export function buildGradeMessage(r: GradeRequest): string {
  const level = LEVEL_TEXT[r.level];
  const lines = [
    `Session: ${MODE_TEXT[r.mode]}${r.partial && r.mode === "full" ? " (he ended it early, so this is a partial sample)" : ""}.`,
    `His practice level: ${level.name}. Write the upgraded answers at band ${level.band}. Advice focus for this level: ${level.focus}.`,
    `Recognizer average confidence: ${r.avgConfidence === null ? "not reported" : r.avgConfidence >= 0.99 ? "reported as 1 for every result (this browser gives no useful confidence)" : r.avgConfidence.toFixed(2)}.`,
    `Saved words due for review: ${r.savedWords.length ? r.savedWords.join(", ") : "none"}.`,
    `"Ayuda" (help panel) used on: ${r.ayuda.length ? r.ayuda.map((q) => `"${q}"`).join("; ") : "none"}.`,
    "",
    "Transcript:",
  ];
  let part = 0;
  let n = 0;
  for (const a of r.answers) {
    if (a.part !== part) {
      part = a.part;
      n = 0;
      lines.push("", `## Part ${part}`);
    }
    n++;
    lines.push("", `Q${n}${a.followup ? " (follow-up)" : ""}. Examiner: ${a.question}`);
    lines.push(`Candidate: ${a.text.trim() || "(no answer)"}`);
    const m = metricsLine(a);
    if (m) lines.push(m);
    const note = OUTCOME_NOTE[a.outcome];
    if (note) lines.push(`[note: ${note}]`);
  }
  return lines.join("\n");
}
