// Transcript checkpoint (SPEC 8, "Timers, notes and safety"): saved to
// localStorage after every commit, so a reload can resume the exam or show
// what exists. Also where a finished session waits until it is saved to the
// server (step 6).

import type { IeltsItems } from "../exams/ielts";
import type { ExamId } from "../exams/types";
import type { ExamMode, LevelId } from "../levels/levels";
import type { AnswerMetrics } from "../shared/grade";

export type AnswerOutcome = "answered" | "no-answer" | "time-limit" | "hard-stop" | "ended";

export interface AnswerRecord {
  stepId: string;
  part: number;
  question: string;
  text: string;
  /** Epoch ms. */
  askedAt: number;
  committedAt: number | null;
  outcome: AnswerOutcome | null;
  /** Times the question was repeated (no speech, request or button). */
  repeats: number;
  repeatRequests: number;
  backupPrompt: boolean;
  /** Recognizer turns that make up this answer (this page load only). */
  turnIds: number[];
  /** Fluency numbers for grading, set when the answer is committed. */
  metrics?: AnswerMetrics;
}

export interface ExamCheckpoint {
  v: 1;
  id: string;
  exam: ExamId;
  mode: ExamMode;
  /** The level whose conditions the session runs under (a full test: always 3). */
  level: LevelId;
  /** His own level, which feedback aims at (SPEC 7); missing in older checkpoints. */
  feedbackLevel?: LevelId;
  startedAt: string;
  updatedAt: string;
  items: IeltsItems;
  /** The season file the questions came from (step 6; saved with the session). */
  season?: string | null;
  /** Saved words due for review, sent to the grader (step 6). */
  dueWords?: string[];
  /** The profile's pause p90 this session's endpointing was calibrated with (step 6). */
  pauseP90Ms?: number | null;
  examinerName: string;
  voiceURI: string | null;
  /** First step not yet completed. */
  nextStep: number;
  /** Inside Part 3: the next listed question to ask on resume. */
  part3Next?: number;
  answers: AnswerRecord[];
  notes: string;
  finished: boolean;
  endedEarly: boolean;
}

export const CHECKPOINT_KEY = "exam.checkpoint.v1";

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): KV | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function saveCheckpoint(cp: ExamCheckpoint, storage: KV | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    // Turn ids mean nothing after a reload.
    const clean = { ...cp, updatedAt: new Date().toISOString(), answers: cp.answers.map((a) => ({ ...a, turnIds: [] })) };
    storage.setItem(CHECKPOINT_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

function isCheckpoint(x: unknown): x is ExamCheckpoint {
  if (!x || typeof x !== "object") return false;
  const c = x as Partial<ExamCheckpoint>;
  return (
    c.v === 1 &&
    typeof c.id === "string" &&
    typeof c.nextStep === "number" &&
    Array.isArray(c.answers) &&
    !!c.items &&
    Array.isArray(c.items.part1) &&
    !!c.items.part2 &&
    typeof c.finished === "boolean"
  );
}

export function loadCheckpoint(storage: KV | null = defaultStorage()): ExamCheckpoint | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CHECKPOINT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCheckpoint(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearCheckpoint(storage: KV | null = defaultStorage()): void {
  try {
    storage?.removeItem(CHECKPOINT_KEY);
  } catch {
    // ignore
  }
}

/** An unfinished exam with at least one answer can be resumed. */
export function canResume(cp: ExamCheckpoint | null): cp is ExamCheckpoint {
  return !!cp && !cp.finished && cp.answers.some((a) => a.outcome !== null);
}
