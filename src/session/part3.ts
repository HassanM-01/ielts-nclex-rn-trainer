// Part 3 rules (SPEC 7 and 8). Pure: the engine calls these; tests cover them.

import type { DiscussionRules, Part3Question } from "../exams/types";
import type { LevelDef } from "../levels/levels";
import { FOLLOWUP_MAX_WORDS, REPLY_END, REPLY_NEXT, type FollowupAllowance } from "../shared/examiner-api";
import { countWords } from "../speech/text";

/** Fire the speculative examiner request after this much silence. */
export const SPECULATIVE_SILENCE_MS = 1_000;
/** Reuse the speculative reply if the committed answer added this many words or fewer. */
export const REUSE_MAX_ADDED_WORDS = 3;
/** Deadline for the examiner reply after the answer is committed; then scripted fallback. */
export const REPLY_DEADLINE_MS = 1_200;
/** Client guard: examiner requests per session. */
export const EXAMINER_CALL_CAP = 40;

export type ExaminerReply = { type: "next" } | { type: "end" } | { type: "followup"; text: string };

// Praise, agreement or evaluation at the start of a reply, and phrases that
// are feedback wherever they appear. The examiner never comments on answers.
const PRAISE_START = /^(great|good|excellent|interesting|nice|wonderful|fantastic|perfect|well done|thank(s| you)|i see|i agree|right|exactly|okay|ok|sure|absolutely|indeed)\b/i;
const FEEDBACK_ANYWHERE = /\b(good point|great answer|good answer|well done|thank you|that's interesting|that is interesting|interesting point|you should|your answer|your english|correct answer)\b/i;

/**
 * Parses and validates the model's reply. Returns null for anything that is
 * not exactly [NEXT], [END] (only allowed with under 45 s left) or a single
 * short question: the engine then asks the scripted next question.
 */
export function parseExaminerReply(raw: string, secondsLeft: number, endAllowedUnderS = 45): ExaminerReply | null {
  let text = raw.replace(/\s+/g, " ").trim();
  if (text.startsWith(REPLY_NEXT)) return { type: "next" };
  if (text.startsWith(REPLY_END)) return secondsLeft < endAllowedUnderS ? { type: "end" } : { type: "next" };

  text = text.replace(/^examiner:\s*/i, "").replace(/^["'“]+|["'”]+$/g, "").trim();
  if (!text || /[[\]{}<>*#\n]/.test(text)) return null;
  if (!text.endsWith("?")) return null;
  if ((text.match(/\?/g) ?? []).length !== 1) return null;
  // At most one short lead-in sentence before the question ("You mentioned X. Why ...?").
  if ((text.match(/[.!](\s|$)/g) ?? []).length > 1) return null;
  const words = countWords(text);
  if (words < 3 || words > FOLLOWUP_MAX_WORDS) return null;
  if (PRAISE_START.test(text) || FEEDBACK_ANYWHERE.test(text)) return null;
  return { type: "followup", text };
}

/**
 * Whether a follow-up may be asked after listed question `qIndex` (0-based).
 * At most one per listed question, and the level's allowance on top.
 */
export function followupAllowed(allowance: FollowupAllowance, qIndex: number, followupsUsed: number, alreadyOnThisQuestion: boolean): boolean {
  if (alreadyOnThisQuestion) return false;
  switch (allowance) {
    case "1-per-question":
      return true;
    case "1-per-2-questions":
      return followupsUsed < Math.floor(qIndex / 2) + 1;
    case "1-per-part":
      return followupsUsed < 1;
  }
}

/** Orders a Part 3 set for the level (SPEC 7 table). */
export function orderPart3(questions: readonly Part3Question[], order: LevelDef["part3Order"]): Part3Question[] {
  const concrete = questions.filter((q) => q.kind === "concrete");
  const abstract = questions.filter((q) => q.kind === "abstract");
  switch (order) {
    case "real":
      return [...questions];
    case "2-concrete-then-abstract":
      return [...concrete.slice(0, 2), ...abstract, ...concrete.slice(2)];
    case "concrete-first-max-1-abstract":
      return [...concrete, ...abstract.slice(0, 1)];
  }
}

/** The engine owns timing: end after the first answer past 4:30, once 4+ listed questions were asked. */
export function shouldEndPart3(elapsedMs: number, listedAsked: number, rules: DiscussionRules): boolean {
  return elapsedMs >= rules.endAfterMs && listedAsked >= rules.minQuestions;
}

export function part3SecondsLeft(elapsedMs: number, rules: DiscussionRules): number {
  return Math.max(0, (rules.lengthMs - elapsedMs) / 1000);
}

/** Reuse the speculative reply if the answer grew by 3 words or fewer since it was sent. */
export function canReuseSpeculative(wordsAtFire: number, wordsAtCommit: number): boolean {
  const added = wordsAtCommit - wordsAtFire;
  return added >= 0 && added <= REUSE_MAX_ADDED_WORDS;
}
