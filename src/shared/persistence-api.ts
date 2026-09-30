// Contract between the browser and /api/sessions, /api/history and
// /api/vocab (SPEC 12). Types only (the server imports them with
// `import type`). All three take the passphrase header (SPEC 4).

import type { ExamId } from "../exams/types";
import type { LevelId } from "../levels/levels";
import type { AnswerMetrics, Grade, VocabItem } from "./grade";

export const PASSPHRASE_HEADER = "x-app-passphrase";

/** An answer as stored in sessions.transcript (the checkpoint's record, without page-only turn ids). */
export interface StoredAnswer {
  stepId: string;
  part: number;
  question: string;
  text: string;
  askedAt: number;
  committedAt: number | null;
  outcome: string | null;
  repeats: number;
  repeatRequests: number;
  backupPrompt: boolean;
  metrics?: AnswerMetrics;
}

export interface SessionTranscript {
  answers: StoredAnswer[];
  notes: string;
  finished: boolean;
  endedEarly: boolean;
  examinerName: string;
  /** The level feedback aimed at (the session's `level` is the conditions level). */
  feedbackLevel: LevelId;
}

export interface SaveSessionRequest {
  /** The checkpoint's uuid: saves are upserts, so retries are safe. */
  id: string;
  startedAt: string;
  exam: ExamId;
  mode: string;
  /** The level whose conditions the session ran under (a full test: 3). */
  level: LevelId;
  season: string | null;
  /** Part 1 topic ids and the Part 2 card id, for the repeat filter. */
  topicIds: string[];
  transcript: SessionTranscript;
  /** The metrics snapshot plus fluency stats, recognizer and voice (SPEC 12). */
  metrics: Record<string, unknown>;
  grade: Grade | null;
  /** p90 of this session's mid-answer pauses (ms), for the next session's endpointing. */
  pauseP90Ms: number | null;
  /** The saved words sent to the grader for review. */
  dueWords: string[];
}

export interface HistoryRow {
  id: string;
  startedAt: string;
  exam: ExamId;
  mode: string;
  level: LevelId;
  overall: number | null;
  /** The three criterion bands, if graded. */
  bands: { fc: number; lr: number; gr: number } | null;
}

export interface HistorySession extends HistoryRow {
  transcript: SessionTranscript;
  grade: Grade | null;
}

export interface VocabRow {
  word: string;
  es: string;
  example: string;
  examTags: string[];
  nclexArea: string;
  timesSeen: number;
  timesUsedCorrectly: number;
  mastered: boolean;
  createdAt: string;
}

export type VocabRequest =
  | { action: "save"; items: VocabItem[]; sessionId: string | null }
  | { action: "mastered"; word: string; mastered: boolean };
