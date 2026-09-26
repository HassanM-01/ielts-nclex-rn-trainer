// Local fluency stats (SPEC 13: shown the moment the exam ends, before any
// band arrives). Pure: computed from the per-answer metrics the engine saved.

import type { AnswerMetrics } from "../shared/grade";

/** Under this much speech, words per minute says nothing. */
const MIN_WPM_MS = 5_000;

export function wordsPerMinute(words: number, speakingMs: number): number | null {
  if (speakingMs < MIN_WPM_MS || words <= 0) return null;
  return Math.round(words / (speakingMs / 60_000));
}

export interface FluencyStats {
  /** Answers with any speech. */
  answered: number;
  speakingMs: number;
  words: number;
  wpm: number | null;
  pausesOver1s: number;
  pausesOver2s: number;
  /** Median time from the end of a question to his first word. */
  firstWordMedianMs: number | null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export function fluencyStats(answers: readonly { metrics?: AnswerMetrics | null }[]): FluencyStats {
  const ms = answers.map((a) => a.metrics).filter((m): m is AnswerMetrics => !!m && m.words > 0);
  const speakingMs = ms.reduce((a, m) => a + m.speakingMs, 0);
  const words = ms.reduce((a, m) => a + m.words, 0);
  return {
    answered: ms.length,
    speakingMs,
    words,
    wpm: wordsPerMinute(words, speakingMs),
    pausesOver1s: ms.reduce((a, m) => a + m.pausesOver1s, 0),
    pausesOver2s: ms.reduce((a, m) => a + m.pausesOver2s, 0),
    firstWordMedianMs: median(ms.map((m) => m.firstWordMs).filter((x): x is number => x !== null)),
  };
}

/** Counts pauses over 1 s and over 2 s. */
export function countPauses(pausesMs: readonly number[]): { over1s: number; over2s: number } {
  return { over1s: pausesMs.filter((p) => p > 1_000).length, over2s: pausesMs.filter((p) => p > 2_000).length };
}
