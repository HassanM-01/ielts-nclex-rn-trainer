// Input validation and row mapping for /api/sessions, /api/history and
// /api/vocab. Own copies of the limits (no browser code runs on the server).

import type { SaveSessionRequest, VocabRequest } from "../../src/shared/persistence-api";
import { GradeOutput } from "./grade-prompt.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXAMS = ["ielts", "clinical", "toefl"];
const EXAM_TAGS: Record<string, string[]> = { ielts: ["ielts"], nclex: ["nclex"], both: ["ielts", "nclex"] };
const NCLEX_AREAS = new Set([
  "Management of Care",
  "Safety and Infection Prevention and Control",
  "Health Promotion and Maintenance",
  "Psychosocial Integrity",
  "Basic Care and Comfort",
  "Pharmacological and Parenteral Therapies",
  "Reduction of Risk Potential",
  "Physiological Adaptation",
]);

export function isUuid(x: unknown): x is string {
  return typeof x === "string" && UUID.test(x);
}

function isStr(x: unknown, max: number): x is string {
  return typeof x === "string" && x.length <= max;
}

function obj(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** Same rule as the browser (SPEC 11): the mean of three whole bands, rounded down to a half band. */
export function overallOf(grade: { fluency_coherence: { band: number }; lexical_resource: { band: number }; grammatical_range: { band: number } }): number {
  const mean = (grade.fluency_coherence.band + grade.lexical_resource.band + grade.grammatical_range.band) / 3;
  return Math.floor(mean * 2 + 1e-9) / 2;
}

export function parseSaveSession(body: unknown): SaveSessionRequest | null {
  const b = obj(body);
  if (!b || !isUuid(b.id)) return null;
  if (typeof b.startedAt !== "string" || Number.isNaN(Date.parse(b.startedAt))) return null;
  if (typeof b.exam !== "string" || !EXAMS.includes(b.exam)) return null;
  if (!isStr(b.mode, 20) || !b.mode) return null;
  if (b.level !== 1 && b.level !== 2 && b.level !== 3) return null;
  if (b.season !== null && !isStr(b.season, 20)) return null;
  if (!Array.isArray(b.topicIds) || b.topicIds.length > 20 || !b.topicIds.every((t) => isStr(t, 100))) return null;
  const tr = obj(b.transcript);
  if (!tr || !Array.isArray(tr.answers) || tr.answers.length > 80 || !tr.answers.every((a) => obj(a))) return null;
  if (!obj(b.metrics)) return null;
  if (b.grade !== null && !GradeOutput.safeParse(b.grade).success) return null;
  const p90 = b.pauseP90Ms;
  if (p90 !== null && !(typeof p90 === "number" && Number.isFinite(p90) && p90 >= 0 && p90 < 60_000)) return null;
  if (!Array.isArray(b.dueWords) || b.dueWords.length > 30 || !b.dueWords.every((w) => isStr(w, 60))) return null;
  return b as unknown as SaveSessionRequest;
}

/** The argument to save_session(s jsonb) (supabase/migrations/0001_init.sql). */
export function sessionRow(r: SaveSessionRequest): Record<string, unknown> {
  return {
    id: r.id,
    started_at: r.startedAt,
    exam: r.exam,
    mode: r.mode,
    level: r.level,
    season: r.season,
    topic_ids: r.topicIds,
    transcript: r.transcript,
    metrics: r.metrics,
    grade: r.grade,
    overall: r.grade ? overallOf(r.grade) : null,
    pause_p90: r.pauseP90Ms === null ? null : Math.round(r.pauseP90Ms),
    due_words: r.dueWords,
  };
}

export function parseVocabRequest(body: unknown): VocabRequest | null {
  const b = obj(body);
  if (!b) return null;
  if (b.action === "mastered") {
    if (!isStr(b.word, 60) || !b.word.trim() || typeof b.mastered !== "boolean") return null;
    return { action: "mastered", word: b.word, mastered: b.mastered };
  }
  if (b.action !== "save" || !Array.isArray(b.items) || b.items.length === 0 || b.items.length > 100) return null;
  if (b.sessionId !== null && !isUuid(b.sessionId)) return null;
  for (const i of b.items) {
    const o = obj(i);
    if (!o || !isStr(o.word, 60) || !o.word.trim() || !isStr(o.es, 200) || !isStr(o.example, 400)) return null;
  }
  return b as unknown as VocabRequest;
}

/** vocab table rows for a save (words are unique and lowercase, SPEC 12). */
export function vocabRows(r: Extract<VocabRequest, { action: "save" }>): Record<string, unknown>[] {
  const seen = new Set<string>();
  return r.items.flatMap((i) => {
    const word = i.word.trim().toLowerCase();
    if (seen.has(word)) return [];
    seen.add(word);
    return [
      {
        word,
        es: i.es,
        example: i.example,
        exam_tags: EXAM_TAGS[String(i.exam).toLowerCase()] ?? ["ielts"],
        nclex_area: NCLEX_AREAS.has(i.nclex_area) ? i.nclex_area : "none",
        first_seen_session: r.sessionId,
      },
    ];
  });
}
