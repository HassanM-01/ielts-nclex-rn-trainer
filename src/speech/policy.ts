// Recognizer and synthesizer timing rules (SPEC 6). Pure, so they can be
// unit tested without a microphone.

import { countWords } from "./text";

/** Restart when the examiner starts speaking if the session is older than this. */
export const PREEMPT_SESSION_AGE_MS = 40_000;
/** Part 2 monologue: restart at the first long-enough pause after this age. */
export const MONOLOGUE_RESTART_AGE_MS = 45_000;
export const MONOLOGUE_RESTART_PAUSE_MS = 700;
/** VAD hears voice this long with no recognition result: stall. */
export const STALL_MS = 3_000;
/** After a stall restart, don't flag another stall for this long. */
export const STALL_COOLDOWN_MS = 5_000;
/** Three network errors inside this window: give up on continuous recognition. */
export const NETWORK_ERROR_WINDOW_MS = 60_000;
export const NETWORK_ERROR_LIMIT = 3;
/** If `end` doesn't arrive this long after stop(), abort and move on. */
export const STOP_TIMEOUT_MS = 1_500;
/** Online voice with no `start` in this long: cancel and retry with a local voice. */
export const ONLINE_VOICE_START_TIMEOUT_MS = 1_500;
/** Local voice with no `start` in this long: the engine is stuck; skip the sentence. */
export const LOCAL_VOICE_START_TIMEOUT_MS = 3_000;

export function shouldPreemptOnExaminerStart(sessionAgeMs: number): boolean {
  return sessionAgeMs > PREEMPT_SESSION_AGE_MS;
}

export function shouldRestartInMonologue(sessionAgeMs: number, currentPauseMs: number): boolean {
  return sessionAgeMs >= MONOLOGUE_RESTART_AGE_MS && currentPauseMs >= MONOLOGUE_RESTART_PAUSE_MS;
}

export interface StallInput {
  now: number;
  /** VAD currently hears voice. */
  voiced: boolean;
  /** When the current continuous voiced stretch began. */
  voiceStartedAt: number;
  /** Last time the recognizer delivered any result (interim or final). */
  lastResultAt: number;
  /** Last stall restart, to avoid restart loops. */
  lastStallAt: number;
}

export function isStall(i: StallInput): boolean {
  if (!i.voiced) return false;
  if (i.now - i.lastStallAt < STALL_COOLDOWN_MS) return false;
  const since = Math.max(i.voiceStartedAt, i.lastResultAt);
  return i.now - since >= STALL_MS;
}

/** Counts `network` errors in a sliding 60 s window. */
export class NetworkErrorWindow {
  private times: number[] = [];

  /** Records an error at `now`; returns true when the limit is reached. */
  record(now: number): boolean {
    this.times.push(now);
    this.times = this.times.filter((t) => now - t < NETWORK_ERROR_WINDOW_MS);
    return this.times.length >= NETWORK_ERROR_LIMIT;
  }

  count(now: number): number {
    return this.times.filter((t) => now - t < NETWORK_ERROR_WINDOW_MS).length;
  }

  reset(): void {
    this.times = [];
  }
}

/**
 * Delay before starting a new recognition session. Immediate normally; backs
 * off when sessions keep dying within a second (so a broken recognizer can't
 * spin the CPU).
 */
export function restartDelayMs(consecutiveShortSessions: number): number {
  if (consecutiveShortSessions <= 1) return 0;
  return Math.min(2_000, 250 * (consecutiveShortSessions - 1));
}

/** Watchdog: treat an utterance as finished after (words x 0.5 s + 2 s). */
export function utteranceWatchdogMs(text: string): number {
  return countWords(text) * 500 + 2_000;
}
