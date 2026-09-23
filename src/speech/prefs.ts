// Speech preferences persisted in localStorage (SPEC 6: persist the voice
// choice; headphones answer from the mic check).

import { ACCENTS, type Accent } from "./voices";

export interface SpeechPrefs {
  /** Settings "pin one accent"; null rotates per session. */
  pinnedAccent: Accent | null;
  /** Accent used last session, for rotation. */
  lastAccent: Accent | null;
  /** A specific voice chosen in the voice picker; null picks automatically. */
  pinnedVoiceURI: string | null;
  headphones: boolean;
  /** The one-time notice about where audio goes has been shown. */
  micNoticeSeen: boolean;
}

const KEY = "speech.prefs.v1";

export const DEFAULT_PREFS: SpeechPrefs = {
  pinnedAccent: null,
  lastAccent: null,
  pinnedVoiceURI: null,
  headphones: false,
  micNoticeSeen: false,
};

function asAccent(x: unknown): Accent | null {
  return typeof x === "string" && (ACCENTS as readonly string[]).includes(x) ? (x as Accent) : null;
}

export function loadPrefs(): SpeechPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const p = JSON.parse(raw) as Partial<Record<keyof SpeechPrefs, unknown>>;
    return {
      pinnedAccent: asAccent(p.pinnedAccent),
      lastAccent: asAccent(p.lastAccent),
      pinnedVoiceURI: typeof p.pinnedVoiceURI === "string" ? p.pinnedVoiceURI : null,
      headphones: p.headphones === true,
      micNoticeSeen: p.micNoticeSeen === true,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: SpeechPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}
