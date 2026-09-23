// Endpointing (SPEC 8): when Julio's answer is committed. Pure functions;
// the engine calls them on every tick.

import type { AnswerRules, EndpointingDefaults, MonologueRules } from "../exams/types";
import { normalizeWords } from "../speech/text";
import { isRepeatRequest } from "./voice-commands";

const CONTINUATION_WORDS = new Set(["and", "but", "because", "so", "or", "then", "like", "the", "a", "my", "um", "uh", "eh"]);
const CONTINUATION_PHRASES = [["for", "example"], ["i", "think"]];

/** The answer so far ends on a word that signals more is coming. */
export function endsWithContinuationCue(text: string): boolean {
  const words = normalizeWords(text);
  const last = words[words.length - 1];
  if (!last) return false;
  if (CONTINUATION_WORDS.has(last)) return true;
  return CONTINUATION_PHRASES.some((p) => p.every((w, i) => words[words.length - p.length + i] === w));
}

/**
 * Personal calibration: next session's base = max(default, p90 of mid-answer
 * pauses + 0.4 s), capped at default + 1.5 s.
 */
export function personalBaseMs(defaultMs: number, pauseP90Ms: number | null): number {
  if (pauseP90Ms === null) return defaultMs;
  return Math.min(defaultMs + 1_500, Math.max(defaultMs, pauseP90Ms + 400));
}

/** 90th percentile of pause lengths (nearest rank), or null with too few. */
export function pauseP90(pausesMs: readonly number[], minSamples = 5): number | null {
  if (pausesMs.length < minSamples) return null;
  const sorted = [...pausesMs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length, Math.ceil(0.9 * sorted.length)) - 1] ?? null;
}

/**
 * Silence that commits this answer. A whole-utterance repeat request is not
 * an answer, so the answer extensions (continuation cue, under 6 words)
 * don't apply to it.
 */
export function commitSilenceMs(text: string, baseMs: number, extraPatienceMs: number, d: EndpointingDefaults): number {
  const base = baseMs + extraPatienceMs;
  if (isRepeatRequest(text)) return base;
  const words = normalizeWords(text).length;
  const extend = endsWithContinuationCue(text) || words < d.shortAnswerWords;
  return base + (extend ? d.continuationExtraMs : 0);
}

// ---- Question-and-answer turns ------------------------------------------

export interface AnswerTurn {
  /** When listening began (the examiner line ended). */
  listenStartedAt: number;
  /** When his first words were recognized, or null. */
  speechStartedAt: number | null;
  /** The question has been repeated once already. */
  repeated: boolean;
}

export interface AnswerTick {
  now: number;
  text: string;
  /** Silence since he last spoke (VAD and recognizer). */
  silenceMs: number;
  /** VAD heard voice in the last second (text may not have arrived yet). */
  voicedRecently: boolean;
  rules: AnswerRules;
  extraPatienceMs: number;
  defaults: EndpointingDefaults;
}

export type AnswerAction =
  | { type: "wait" }
  | { type: "commit" }
  /** A whole-utterance repeat request ("Sorry?"). */
  | { type: "repeat-request" }
  /** No speech: repeat the question once. */
  | { type: "no-speech-repeat" }
  /** No speech after the repeat: move on without an answer. */
  | { type: "move-on" }
  /** Answer ran past the time limit: the examiner cuts in. */
  | { type: "time-limit" };

export function decideAnswer(turn: AnswerTurn, t: AnswerTick): AnswerAction {
  const hasSpeech = normalizeWords(t.text).length > 0;
  // Silence can't predate this listening turn (e.g. after a repeat).
  const silence = Math.min(t.silenceMs, t.now - turn.listenStartedAt);

  if (hasSpeech) {
    const started = turn.speechStartedAt ?? t.now;
    if (t.rules.maxAnswerMs !== null && t.now - started >= t.rules.maxAnswerMs) return { type: "time-limit" };
    if (silence >= commitSilenceMs(t.text, t.rules.baseSilenceMs, t.extraPatienceMs, t.defaults)) {
      return isRepeatRequest(t.text) ? { type: "repeat-request" } : { type: "commit" };
    }
    return { type: "wait" };
  }

  // The VAD can postpone the no-speech repeat (words may be on their way),
  // but only by one more no-speech period: room noise must not stall the exam.
  if (t.voicedRecently && t.now - turn.listenStartedAt < 2 * t.defaults.noSpeechMs) return { type: "wait" };
  if (t.now - turn.listenStartedAt >= t.defaults.noSpeechMs) {
    return turn.repeated ? { type: "move-on" } : { type: "no-speech-repeat" };
  }
  return { type: "wait" };
}

// ---- Part 2 long turn -----------------------------------------------------

export interface MonologueTurn {
  /** When "Please start speaking now" ended: the 2:00 clock starts here. */
  startedAt: number;
  /** When the current listening stretch began (after the start line or a prompt). */
  listenStartedAt: number;
  speechStartedAt: number | null;
  backupUsed: boolean;
  /** "Please start speaking now" has been repeated. */
  startRepeated: boolean;
}

export interface MonologueTick {
  now: number;
  text: string;
  silenceMs: number;
  voicedRecently: boolean;
  rules: MonologueRules;
  noSpeechMs: number;
}

export type MonologueAction =
  | { type: "wait" }
  | { type: "hard-stop" }
  | { type: "backup-prompt" }
  | { type: "commit" }
  | { type: "repeat-start" }
  | { type: "move-on" };

export function decideMonologue(m: MonologueTurn, t: MonologueTick): MonologueAction {
  const elapsed = t.now - m.startedAt;
  if (elapsed >= t.rules.hardStopMs) return { type: "hard-stop" };

  const hasSpeech = normalizeWords(t.text).length > 0;
  const silence = Math.min(t.silenceMs, t.now - m.listenStartedAt);

  if (!hasSpeech) {
    if (t.voicedRecently && t.now - m.listenStartedAt < 2 * t.noSpeechMs) return { type: "wait" };
    if (t.now - m.listenStartedAt >= t.noSpeechMs) return m.startRepeated ? { type: "move-on" } : { type: "repeat-start" };
    return { type: "wait" };
  }

  const beforeGoal = elapsed < t.rules.goalMs;
  if (beforeGoal && !m.backupUsed) {
    return silence >= t.rules.backupSilenceMs ? { type: "backup-prompt" } : { type: "wait" };
  }
  return silence >= t.rules.endSilenceMs ? { type: "commit" } : { type: "wait" };
}

const STOPWORDS = new Set([
  "a", "an", "the", "you", "your", "it", "was", "is", "were", "what", "where", "when", "who", "why", "how", "which",
  "there", "to", "of", "in", "on", "at", "and", "or", "did", "do", "does", "this", "that", "for", "with", "about", "made",
]);

function contentWords(text: string): string[] {
  return normalizeWords(text).filter((w) => !STOPWORDS.has(w) && w.length > 2);
}

/** Loose stem match so "noise" counts for "noisy" and "went" doesn't. */
function mentions(said: Set<string>, word: string): boolean {
  const stem = word.slice(0, Math.max(4, word.length - 2));
  for (const s of said) if (s.startsWith(stem)) return true;
  return false;
}

/** The cue card bullet he has said the least about, for the back-up prompt. */
export function pickUnusedBullet(bullets: readonly string[], spoken: string): string | null {
  if (bullets.length === 0) return null;
  const said = new Set(normalizeWords(spoken));
  let best: string | null = null;
  let bestScore = Infinity;
  for (const b of bullets) {
    const words = contentWords(b);
    const hits = words.filter((w) => mentions(said, w)).length;
    // A bullet with no content words ("where it was") can't be checked: rank
    // it between clearly covered and clearly uncovered bullets.
    const score = words.length ? hits / words.length : 0.5;
    if (score < bestScore) {
      best = b;
      bestScore = score;
    }
  }
  return best;
}
