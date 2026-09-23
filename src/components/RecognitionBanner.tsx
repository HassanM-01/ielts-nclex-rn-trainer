import { fill, t } from "../i18n";
import { currentBrowser } from "../speech/browser";
import type { SpeechController } from "../speech/controller";
import type { RecognizerFailure } from "../speech/recognizer";

const MESSAGES: Record<RecognizerFailure, string> = {
  network: t.recognition.network,
  "not-allowed": t.recognition.notAllowed,
  "audio-capture": t.recognition.audioCapture,
  language: t.recognition.language,
  start: t.recognition.start,
  unsupported: t.recognition.unsupported,
};

/**
 * Spanish banner when continuous recognition fails, with the push-to-talk
 * way forward (SPEC 6, "Failure").
 */
export function RecognitionBanner({ speech }: { speech: SpeechController }) {
  const failure = speech.failure;
  if (!failure) return null;
  const other = currentBrowser() === "edge" ? t.recognition.otherBrowserChrome : t.recognition.otherBrowserEdge;
  const pttUsable = speech.recognizer.mode === "push-to-talk";
  const active = speech.recognizer.isCapturing;
  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <p>{fill(MESSAGES[failure], { other })}</p>
      {pttUsable && (
        <button
          type="button"
          className={`mt-3 select-none rounded-lg px-5 py-3 font-medium text-white ${active ? "bg-red-600" : "bg-slate-800"}`}
          onPointerDown={() => speech.pttDown()}
          onPointerUp={() => speech.pttUp()}
          onPointerLeave={() => speech.pttUp()}
        >
          {active ? t.recognition.pushToTalkActive : t.recognition.pushToTalk}
        </button>
      )}
    </div>
  );
}
