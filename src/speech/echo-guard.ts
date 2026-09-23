// Echo handling (SPEC 6, "Barge-in and echo"). Pure functions.

import { normalizeWords } from "./text";

/**
 * Minimum overlap before a leading run counts as echo. One word is too
 * risky: "What do you like about it?" / "It is nice" must not lose "It".
 */
export const ECHO_MIN_WORDS = 2;

/**
 * Strip a leading run of words from Julio's first result in a turn if it
 * matches the tail of the examiner's last line. Returns the result with the
 * echo removed (original casing and spacing of the kept part preserved).
 */
export function trimEcho(examinerLine: string, result: string, minWords = ECHO_MIN_WORDS): string {
  const line = normalizeWords(examinerLine);
  const tokens = result.trim().split(/\s+/).filter(Boolean);
  const heard = tokens.map((t) => normalizeWords(t).join(" "));
  if (line.length === 0 || heard.length === 0) return result.trim();

  const maxK = Math.min(line.length, heard.length);
  for (let k = maxK; k >= minWords; k--) {
    let match = true;
    for (let j = 0; j < k; j++) {
      if (heard[j] !== line[line.length - k + j]) {
        match = false;
        break;
      }
    }
    if (match) return tokens.slice(k).join(" ");
  }
  return result.trim();
}

/**
 * Words heard during examiner audio that aren't in the examiner's own line.
 * A sensitive mic can pick up the examiner through headphones; those words
 * must not count as Julio talking over the examiner.
 */
export function nonEchoWordCount(examinerLine: string, heard: string): number {
  const line = new Set(normalizeWords(examinerLine));
  return normalizeWords(heard).filter((w) => !line.has(w)).length;
}

export interface BargeInInput {
  headphones: boolean;
  examinerSpeaking: boolean;
  /** Examiner interruptions (Part 1 time limit, Part 2 hard stop) are not interruptible. */
  interruptible: boolean;
  /** VAD heard voice recently; null when the VAD stream is unavailable. */
  vadVoiced: boolean | null;
  /** Words recognized since the examiner line started, not counting the examiner's own words. */
  recognizedWords: number;
}

/**
 * Speech during examiner audio (VAD energy plus at least 2 recognized
 * words) cancels synthesis, but only with headphones on. Without the VAD
 * stream, the word count alone decides (headphones mean no echo).
 */
export function shouldBargeIn(i: BargeInInput): boolean {
  if (!i.headphones || !i.examinerSpeaking || !i.interruptible) return false;
  if (i.recognizedWords < 2) return false;
  return i.vadVoiced !== false;
}
