// Mic check (SPEC 6 and 13): records 3 s, plays it back, shows the
// transcript and a level meter, asks about headphones, and speaks one
// examiner line. Its clicks are the user gestures that unlock audio.

import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { SpeechController } from "../speech/controller";
import { MicMeter } from "./MicMeter";

type Step = "notice" | "ready" | "recording" | "playing" | "result" | "examiner" | "done";

const RECORD_MS = 3_000;
const EXAMINER_LINE = "Hello. This is a quick sound check. If you can hear me clearly, you're ready to begin.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function MicCheck({ speech }: { speech: SpeechController }) {
  const [step, setStep] = useState<Step>(speech.prefs.micNoticeSeen ? "ready" : "notice");
  const [turnId, setTurnId] = useState<number | null>(null);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const record = async () => {
    if (!speech.started) await speech.start();
    const turn = speech.newTurn("candidate", "");
    setTurnId(turn.id);
    setPlaybackFailed(false);
    setStep("recording");

    const stream = speech.vad?.stream;
    const chunks: Blob[] = [];
    let recorder: MediaRecorder | null = null;
    if (stream && typeof MediaRecorder !== "undefined") {
      try {
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.start();
      } catch {
        recorder = null;
      }
    }
    await sleep(RECORD_MS);
    // Playback must not end up in anyone's transcript.
    speech.newTurn("discard", "");

    if (!recorder) {
      setPlaybackFailed(true);
      setStep("result");
      return;
    }
    const rec = recorder;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType }));
    const audio = new Audio(urlRef.current);
    setStep("playing");
    try {
      await audio.play();
      await new Promise((resolve) => {
        audio.onended = resolve;
        audio.onerror = resolve;
      });
    } catch {
      setPlaybackFailed(true);
    }
    setStep("result");
  };

  const answerHeadphones = async (on: boolean) => {
    speech.setHeadphones(on);
    setStep("examiner");
    await speech.say(EXAMINER_LINE, { then: "discard" });
    setStep("done");
  };

  const heard = turnId !== null ? speech.turnText(turnId) : "";
  const vadMissing = speech.started && !speech.vad;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4" lang="es">
      <h2 className="mb-3 text-lg font-semibold">{t.micCheck.title}</h2>

      {step === "notice" && (
        <div>
          <h3 className="mb-1 font-medium">{t.micCheck.noticeTitle}</h3>
          <p className="mb-3 text-slate-700">{t.micCheck.notice}</p>
          <button
            type="button"
            className="rounded-lg bg-slate-800 px-4 py-2 text-white"
            onClick={() => {
              speech.markMicNoticeSeen();
              setStep("ready");
            }}
          >
            {t.micCheck.noticeOk}
          </button>
        </div>
      )}

      {step !== "notice" && (
        <div className="mb-3">
          <div className="mb-1 text-sm text-slate-500">{t.micCheck.level}</div>
          <MicMeter frame={speech.vad?.lastFrame ?? null} label={t.micCheck.level} showMarkers={false} />
          {vadMissing && <p className="mt-1 text-sm text-amber-700">{t.vad.unavailable}</p>}
          {speech.started && (
            <>
              <p className="mt-2 text-sm">
                <span className="text-slate-500">{t.micCheck.micInUse}</span> {speech.micLabel || t.micCheck.micUnknown}
              </p>
              <p className="text-xs text-slate-500">{t.micCheck.wrongMic}</p>
            </>
          )}
        </div>
      )}

      {step === "ready" && (
        <div>
          <p className="mb-3 text-slate-700">{t.micCheck.intro}</p>
          <button type="button" className="rounded-lg bg-slate-800 px-4 py-2 text-white" onClick={() => void record()}>
            {t.micCheck.record}
          </button>
        </div>
      )}

      {step === "recording" && <p className="font-medium text-rose-700">{t.micCheck.recording}</p>}
      {step === "playing" && <p className="text-slate-700">{t.micCheck.playing}</p>}

      {(step === "result" || step === "examiner" || step === "done" || step === "playing") && (
        <div className="mt-2">
          {heard ? (
            <p>
              <span className="text-slate-500">{t.micCheck.heard}</span> <span lang="en">“{heard}”</span>
            </p>
          ) : (
            step !== "playing" && <p className="text-amber-700">{t.micCheck.heardNothing}</p>
          )}
          {playbackFailed && <p className="text-sm text-slate-500">{t.micCheck.noPlayback}</p>}
        </div>
      )}

      {step === "result" && (
        <div className="mt-4">
          <p className="mb-1 font-medium">{t.micCheck.headphonesQuestion}</p>
          <p className="mb-3 text-sm text-slate-600">{t.micCheck.headphonesAdvice}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg bg-slate-800 px-4 py-2 text-white" onClick={() => void answerHeadphones(true)}>
              {t.micCheck.headphonesYes}
            </button>
            <button type="button" className="rounded-lg border border-slate-300 px-4 py-2" onClick={() => void answerHeadphones(false)}>
              {t.micCheck.headphonesNo}
            </button>
            <button type="button" className="rounded-lg px-4 py-2 text-slate-600 underline" onClick={() => setStep("ready")}>
              {t.micCheck.retry}
            </button>
          </div>
        </div>
      )}

      {step === "examiner" && <p className="mt-3 text-slate-700">{t.micCheck.examinerTest}</p>}

      {step === "done" && (
        <div className="mt-3">
          <p className="font-medium text-emerald-700">{t.micCheck.done}</p>
          <button type="button" className="mt-2 text-sm text-slate-600 underline" onClick={() => setStep("ready")}>
            {t.micCheck.retry}
          </button>
        </div>
      )}
    </section>
  );
}
