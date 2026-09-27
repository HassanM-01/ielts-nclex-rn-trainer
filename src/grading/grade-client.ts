// Browser side of /api/grade (SPEC 11). One grading job at a time, started
// when the closing line begins; the results screen subscribes to it and
// renders each section as soon as it closes in the stream. The finished
// grade is kept in localStorage so a reload doesn't pay for grading again
// (step 6 saves it with the session).

import { DEFAULT_LEVEL } from "../levels/levels";
import { countWords } from "../speech/text";
import {
  GRADE_LIMITS,
  MIN_WORDS_TO_GRADE,
  normalizeGrade,
  type Grade,
  type GradeEvent,
  type GradeMode,
  type GradeRequest,
  type GradeUsage,
} from "../shared/grade";
import type { ExamCheckpoint } from "../session/checkpoint";
import { getToken } from "../session/token-client";
import { parsePartialJson, type PartialResult } from "./partial-json";

const GRADE_MODES: GradeMode[] = ["full", "part1", "parts23", "quick"];
const SAVED_KEY = "exam.grade.v1";

/**
 * A partial sample: not a full test, or a full test ended early or never
 * finished. `reachedClosing`: grading starts as the closing line begins,
 * just before the checkpoint is marked finished.
 */
export function isPartial(cp: Pick<ExamCheckpoint, "mode" | "endedEarly" | "finished">, reachedClosing = false): boolean {
  return cp.mode !== "full" || cp.endedEarly || !(cp.finished || reachedClosing);
}

/**
 * The /api/grade request for a checkpoint, or null when there is nothing
 * worth grading (another exam, or fewer than MIN_WORDS_TO_GRADE words). The
 * opening (name, identification) isn't assessed, so it isn't sent.
 */
export function buildGradeRequest(cp: ExamCheckpoint, avgConfidence: number | null, reachedClosing = false): GradeRequest | null {
  if (cp.exam !== "ielts" || !GRADE_MODES.includes(cp.mode as GradeMode)) return null;
  const answers = cp.answers
    .filter((a) => a.part >= 1 && a.part <= 3 && a.outcome !== null)
    .slice(0, GRADE_LIMITS.answers)
    .map((a) => ({
      part: a.part,
      question: a.question.slice(0, GRADE_LIMITS.questionChars),
      text: a.text.slice(0, GRADE_LIMITS.answerChars),
      outcome: a.outcome ?? "answered",
      followup: a.stepId.endsWith("-f"),
      metrics: a.metrics ?? null,
    }));
  const words = answers.reduce((n, a) => n + countWords(a.text), 0);
  if (answers.length === 0 || words < MIN_WORDS_TO_GRADE) return null;
  return {
    kind: "grade",
    mode: cp.mode as GradeMode,
    level: cp.feedbackLevel ?? DEFAULT_LEVEL,
    partial: isPartial(cp, reachedClosing),
    answers,
    // Saved words due for review arrive with step 6; "Ayuda" with step 7.
    savedWords: [],
    ayuda: [],
    avgConfidence: avgConfidence === null ? null : Math.min(1, Math.max(0, avgConfidence)),
  };
}

// ---- the job ---------------------------------------------------------------------

export type GradeStatus = "streaming" | "done" | "too-short" | "error";
export type GradeFailure = "no-token" | "network" | "server";

export interface GradeJob {
  sessionId: string;
  status: GradeStatus;
  failure: GradeFailure | null;
  /** The model's JSON so far, and what can be read from it. */
  text: string;
  partial: PartialResult;
  grade: Grade | null;
  /** performance.now() when the request went out, when the first criterion closed, and when it ended. */
  startedAt: number;
  firstBandAt: number | null;
  endedAt: number | null;
  /** Tokens billed (from the server), once done. */
  usage: GradeUsage | null;
  /** Loaded from localStorage rather than graded now. */
  fromStorage: boolean;
}

let job: GradeJob | null = null;
let ctrl: AbortController | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const fn of listeners) fn();
}

export function subscribeGrade(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function currentGradeJob(sessionId: string): GradeJob | null {
  return job?.sessionId === sessionId ? job : null;
}

type KV = Pick<Storage, "getItem" | "setItem">;

function storage(): KV | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSavedGrade(sessionId: string, kv: KV | null = storage()): Grade | null {
  try {
    const raw = kv?.getItem(SAVED_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as { sessionId?: unknown; grade?: unknown };
    return data.sessionId === sessionId ? normalizeGrade(data.grade) : null;
  } catch {
    return null;
  }
}

function saveGrade(sessionId: string, grade: Grade, kv: KV | null = storage()): void {
  try {
    kv?.setItem(SAVED_KEY, JSON.stringify({ sessionId, grade, gradedAt: new Date().toISOString() }));
  } catch {
    // Kept for this page only.
  }
}

const EMPTY: PartialResult = { value: undefined, complete: false, closedKeys: [] };

/**
 * Starts grading `cp` unless it is already being graded or was graded
 * (`force` grades again, for "Intentar de nuevo"). Never throws: failures
 * end as status "error" with a reason the screen explains in Spanish.
 */
export function startGrading(
  cp: ExamCheckpoint,
  avgConfidence: number | null,
  opts: { force?: boolean; reachedClosing?: boolean; fetchImpl?: typeof fetch } = {},
): GradeJob {
  const existing = currentGradeJob(cp.id);
  if (existing && !opts.force && existing.status !== "error") return existing;
  const saved = opts.force ? null : loadSavedGrade(cp.id);
  const now = performance.now();
  const base: GradeJob = {
    sessionId: cp.id,
    status: "streaming",
    failure: null,
    text: "",
    partial: EMPTY,
    grade: null,
    startedAt: now,
    firstBandAt: null,
    endedAt: null,
    usage: null,
    fromStorage: false,
  };
  if (saved) {
    job = { ...base, status: "done", grade: saved, firstBandAt: now, endedAt: now, fromStorage: true };
    changed();
    return job;
  }
  const body = buildGradeRequest(cp, avgConfidence, opts.reachedClosing);
  if (!body) {
    job = { ...base, status: "too-short" };
    changed();
    return job;
  }
  ctrl?.abort();
  ctrl = new AbortController();
  job = base;
  changed();
  void run(job, body, ctrl.signal, opts.fetchImpl ?? ((...a) => fetch(...a)));
  return job;
}

async function run(j: GradeJob, body: GradeRequest, signal: AbortSignal, fetchImpl: typeof fetch): Promise<void> {
  const fail = (failure: GradeFailure) => {
    j.status = "error";
    j.failure = failure;
    j.endedAt = performance.now();
    changed();
  };
  const token = await getToken();
  if (!token) return fail("no-token");
  let res: Response;
  try {
    res = await fetchImpl("/api/grade", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    return fail("network");
  }
  if (!res.ok || !res.body) return fail(res.status === 401 ? "no-token" : "server");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        if (!applyEvent(j, JSON.parse(line) as GradeEvent)) return;
      }
      j.partial = parsePartialJson(j.text);
      if (j.firstBandAt === null && j.partial.closedKeys.includes("fluency_coherence")) j.firstBandAt = performance.now();
      changed();
    }
  } catch {
    if (signal.aborted) return;
    return fail("network");
  }
  // The stream ended without a result.
  if (j.status === "streaming") fail("network");
}

/** Applies one stream event; returns false when the job has ended. */
function applyEvent(j: GradeJob, e: GradeEvent): boolean {
  switch (e.t) {
    case "delta":
      j.text += e.v;
      return true;
    case "reset":
      j.text = "";
      j.partial = EMPTY;
      return true;
    case "done": {
      const grade = normalizeGrade(e.grade);
      j.endedAt = performance.now();
      if (!grade) {
        j.status = "error";
        j.failure = "server";
      } else {
        j.grade = grade;
        j.usage = e.usage ?? null;
        j.status = "done";
        j.firstBandAt ??= j.endedAt;
        saveGrade(j.sessionId, grade);
      }
      changed();
      return false;
    }
    case "error":
      j.status = "error";
      j.failure = "server";
      j.endedAt = performance.now();
      changed();
      return false;
  }
}

/** Tests only. */
export function resetGradeJob(): void {
  ctrl?.abort();
  ctrl = null;
  job = null;
}
