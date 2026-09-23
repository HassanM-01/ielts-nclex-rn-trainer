// Examiner voice selection (SPEC 6, "Synthesis"). Pure functions over a
// plain voice shape, so they run in tests without speechSynthesis.

export interface VoiceInfo {
  name: string;
  lang: string;
  localService: boolean;
  voiceURI: string;
  default: boolean;
}

export const ACCENTS = ["en-GB", "en-US", "en-AU"] as const;
export type Accent = (typeof ACCENTS)[number];

export function normalizeLang(lang: string): string {
  const [base = "", region] = lang.replace("_", "-").split("-");
  return region ? `${base.toLowerCase()}-${region.toUpperCase()}` : base.toLowerCase();
}

export function isEnglish(v: VoiceInfo): boolean {
  return normalizeLang(v.lang).startsWith("en");
}

export function isNatural(v: VoiceInfo): boolean {
  return /natural/i.test(v.name);
}

/** Natural en-* (Edge online) > Google en-* > any en-* > not English. */
export function rankVoice(v: VoiceInfo): number {
  if (!isEnglish(v)) return 0;
  if (isNatural(v)) return 3;
  if (/google/i.test(v.name)) return 2;
  return 1;
}

export function accentOf(lang: string): Accent | null {
  const n = normalizeLang(lang);
  return (ACCENTS as readonly string[]).includes(n) ? (n as Accent) : null;
}

export function availableAccents(voices: VoiceInfo[]): Accent[] {
  return ACCENTS.filter((a) => voices.some((v) => accentOf(v.lang) === a));
}

/**
 * Rotate the accent per session (en-GB -> en-US -> en-AU) among the accents
 * that have a voice, unless one is pinned in settings.
 */
export function nextAccent(available: Accent[], last: Accent | null, pinned: Accent | null): Accent | null {
  if (available.length === 0) return null;
  if (pinned && available.includes(pinned)) return pinned;
  if (!last) return available[0] ?? null;
  const order = ACCENTS.filter((a) => available.includes(a));
  const idx = order.indexOf(last);
  return order[(idx + 1) % order.length] ?? null;
}

function best(voices: VoiceInfo[]): VoiceInfo | null {
  let top: VoiceInfo | null = null;
  for (const v of voices) {
    if (rankVoice(v) === 0) continue;
    if (!top || rankVoice(v) > rankVoice(top)) top = v;
  }
  return top;
}

/** Best voice for the accent; falls back to the best English voice. */
export function pickVoice(voices: VoiceInfo[], accent: Accent | null): VoiceInfo | null {
  if (accent) {
    const forAccent = best(voices.filter((v) => accentOf(v.lang) === accent));
    if (forAccent) return forAccent;
  }
  return best(voices);
}

/** Local (offline) English voice for when an online voice doesn't start. */
export function pickLocalFallback(voices: VoiceInfo[], accent: Accent | null): VoiceInfo | null {
  const local = voices.filter((v) => v.localService && isEnglish(v));
  return pickVoice(local, accent);
}

const NAMES: Record<Accent, { female: string; male: string; neutral: string }> = {
  "en-GB": { female: "Emma", male: "James", neutral: "Alex" },
  "en-US": { female: "Sarah", male: "Michael", neutral: "Jordan" },
  "en-AU": { female: "Olivia", male: "Jack", neutral: "Sam" },
};

// Google voices whose gender isn't in the name.
const GOOGLE_FEMALE = /google (us english|uk english female|australian)/i;

/** A first name that fits the voice, for the examiner's greeting. */
export function examinerName(v: VoiceInfo): string {
  const accent = accentOf(v.lang) ?? "en-US";
  const ms = /^Microsoft\s+([A-Z][a-z]+)/.exec(v.name);
  if (ms?.[1]) return ms[1];
  if (/female/i.test(v.name) || GOOGLE_FEMALE.test(v.name)) return NAMES[accent].female;
  if (/\bmale\b/i.test(v.name)) return NAMES[accent].male;
  // macOS and similar: the voice name is a first name ("Daniel", "Karen").
  if (/^[A-Z][a-z]+$/.test(v.name)) return v.name;
  return NAMES[accent].neutral;
}
