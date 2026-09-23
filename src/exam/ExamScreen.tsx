// Exam screen (SPEC 13): minimal. State indicator, mic level, live interim
// transcript, timers, cue card in Part 2, "Repetir pregunta", "Terminar",
// and a spacebar hint for "Listo". No feedback of any kind.

import { useEffect, useState } from "react";
import { navigate } from "../app/router";
import { useSpeech } from "../app/speech";
import { MicMeter } from "../components/MicMeter";
import { RecognitionBanner } from "../components/RecognitionBanner";
import { t } from "../i18n";
import { getActiveExam, useExam } from "../session/exam-session";
import type { ExamEngine } from "../session/engine";
import { CueCardView } from "./CueCardView";

function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

type Status = keyof typeof t.exam.status;

export function ExamScreen() {
  const speech = useSpeech();
  const engine = getActiveExam();
  useExam(engine);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const done = !engine || engine.phase.kind === "done";
  useEffect(() => {
    if (!engine) navigate("/");
    else if (engine.phase.kind === "done") navigate("/transcripcion");
  }, [engine, done]);

  useEffect(() => {
    if (!engine) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      e.preventDefault(); // don't click a focused button
      engine.commitNow();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [engine]);

  if (!engine) {
    return (
      <main className="mx-auto max-w-2xl p-6" lang="es">
        <p>{t.exam.noExam}</p>
      </main>
    );
  }

  const now = performance.now();
  const p = engine.phase;
  const status: Status =
    p.kind === "listening" || p.kind === "monologue"
      ? "listening"
      : p.kind === "prep"
        ? "preparing"
        : speech.examinerAudible
          ? "speaking"
          : "thinking";
  const pill: Record<Status, string> = {
    speaking: "bg-sky-600",
    listening: "bg-emerald-600",
    thinking: "bg-slate-500",
    preparing: "bg-amber-600",
  };

  const rec = "stepIndex" in p ? engine.answers.find((a) => a.stepId === stepId(engine, p.stepIndex)) : undefined;
  const live = rec ? engine.answerText(rec) : "";
  const showCard = engine.card && (engine.state === "part2_prep" || engine.state === "part2_speak");
  const canRepeat = p.kind === "listening" || p.kind === "monologue";

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6" lang="es">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t.exam.parts[engine.state]}</h1>
          <p className="text-sm text-slate-500">
            {t.exam.partTime}: <span className="font-mono">{clock(now - engine.stateStartedAt)}</span>
          </p>
        </div>
        <span className={`rounded-full px-4 py-1.5 font-medium text-white ${pill[status]}`}>{t.exam.status[status]}</span>
      </header>

      <RecognitionBanner speech={speech} />
      <MicMeter frame={speech.vad?.lastFrame ?? null} label={t.micCheck.level} showMarkers={false} />

      {p.kind === "prep" && (
        <p className="text-lg">
          {t.exam.prepLeft}: <span className="font-mono font-semibold">{clock(p.endsAt - now)}</span>
        </p>
      )}
      {p.kind === "monologue" && (
        <p className="text-lg">
          {t.exam.speakLeft}: <span className="font-mono font-semibold">{clock(p.m.startedAt + stepRules(engine, p.stepIndex) - now)}</span>
        </p>
      )}

      {showCard && engine.card && (
        <>
          <CueCardView card={engine.card} />
          <label className="block">
            <span className="text-sm text-slate-600">{t.exam.notes}</span>
            <textarea
              className="mt-1 h-32 w-full rounded-lg border border-slate-300 p-2"
              placeholder={t.exam.notesPlaceholder}
              value={engine.notes}
              onChange={(e) => engine.setNotes(e.target.value)}
            />
          </label>
        </>
      )}

      <section>
        <h2 className="mb-1 text-sm text-slate-500">{t.exam.liveTranscript}</h2>
        <p className="min-h-16 rounded-lg bg-white p-3 text-slate-800" lang="en">
          {live || <span className="text-slate-300">…</span>}
        </p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2 disabled:opacity-40" disabled={!canRepeat} onClick={() => engine.repeatLast()}>
          {t.exam.repeat}
        </button>
        {confirmEnd ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{t.exam.endConfirm}</span>
            <button type="button" className="rounded-lg bg-rose-700 px-3 py-2 text-white" onClick={() => engine.end()}>
              {t.exam.endYes}
            </button>
            <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-2" onClick={() => setConfirmEnd(false)}>
              {t.exam.endNo}
            </button>
          </span>
        ) : (
          <button type="button" className="rounded-lg px-4 py-2 text-rose-700 underline" onClick={() => setConfirmEnd(true)}>
            {t.exam.end}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-500">{t.exam.spaceHint}</p>
    </main>
  );
}

function stepId(engine: ExamEngine, i: number): string | undefined {
  const s = engine.steps[i];
  return s && (s.kind === "ask" || s.kind === "monologue") ? s.id : undefined;
}

function stepRules(engine: ExamEngine, i: number): number {
  const s = engine.steps[i];
  return s?.kind === "monologue" ? s.rules.hardStopMs : 0;
}
