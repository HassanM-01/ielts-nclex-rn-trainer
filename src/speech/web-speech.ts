// Minimal typings for the Web Speech recognition API, which isn't in the
// TypeScript DOM lib. Only what the recognizer uses.

export interface SRAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

export interface SRResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SRAlternative;
}

export interface SRResultList {
  readonly length: number;
  [index: number]: SRResult;
}

export interface SRResultEvent extends Event {
  readonly resultIndex: number;
  readonly results: SRResultList;
}

export interface SRErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

export interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((e: Event) => void) | null;
  onaudiostart: ((e: Event) => void) | null;
  onresult: ((e: SRResultEvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: ((e: Event) => void) | null;
}

export type OnDeviceAvailability = "available" | "downloadable" | "downloading" | "unavailable";

export interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike;
  // Newer Chromium only. Never call install() (SPEC 6).
  available?: (options: { langs: string[]; processLocally: boolean }) => Promise<OnDeviceAvailability>;
}

export function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** "available" etc., or "unknown" when the browser has no available(). */
export async function onDeviceModelStatus(lang: string): Promise<OnDeviceAvailability | "unknown"> {
  const ctor = getRecognitionCtor();
  if (!ctor || typeof ctor.available !== "function") return "unknown";
  try {
    return await ctor.available({ langs: [lang], processLocally: true });
  } catch {
    return "unknown";
  }
}
