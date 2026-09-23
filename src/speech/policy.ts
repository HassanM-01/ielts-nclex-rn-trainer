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
/** After a stall restart, don't flag another stall for this long (doubles per stall in a row). */
export const STALL_COOLDOWN_MS = 5_000;
export const STALL_COOLDOWN_MAX_MS = 30_000;
/**
 * No new recognized words for this long means Julio has stopped, even if the
 * VAD still hears "voice" (room noise it hasn't learned yet).
 */
export const RESULT_SILENCE_OVERRIDE_MS = 5_000;
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
  /** Stall restarts in a row with no text in between. */
  streak?: number;
}

/**
 * Cooldown after a stall restart: 5 s, doubling for each stall in a row with
 * no text in between (so a restart that didn't help can't spin), capped at 30 s.
 */
export function stallCooldownMs(streak: number): number {
  return Math.min(STALL_COOLDOWN_MAX_MS, STALL_COOLDOWN_MS * 2 ** Math.max(0, streak - 1));
}

export function isStall(i: StallInput): boolean {
  if (!i.voiced) return false;
  if (i.now - i.lastStallAt < stallCooldownMs(i.streak ?? 1)) return false;
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

/**
 * Silence used for endpointing. Normally the shorter of the VAD silence and
 * the time since the last recognized words, so a quiet voice the VAD misses
 * can't end a turn early. But once no words have arrived for 5 s, trust the
 * recognizer: the VAD can't hold a turn open forever on room noise.
 */
export function effectiveSilenceMs(vadSilenceMs: number | null, sinceResultMs: number): number {
  if (!Number.isFinite(sinceResultMs)) return vadSilenceMs ?? 0;
  if (sinceResultMs >= RESULT_SILENCE_OVERRIDE_MS) return sinceResultMs;
  return Math.min(vadSilenceMs ?? Infinity, sinceResultMs);
}

/** Watchdog: treat an utterance as finished after (words x 0.5 s + 2 s). */
export function utteranceWatchdogMs(text: string): number {
  return countWords(text) * 500 + 2_000;
}
