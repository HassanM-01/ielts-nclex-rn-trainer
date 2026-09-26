// "Reintentar" for one upgraded answer (SPEC 13): the examiner re-asks the
// question, Julio answers again, and a quick model call compares the two
// attempts in two lines of Spanish.

import { useEffect, useReducer, useRef, useState } from "react";
import { getSpeech, useSpeech } from "../app/speech";
import { RecognitionBanner } from "../components/RecognitionBanner";
import { compareAttempts, RetryAttempt } from "../grading/retry";
import { t } from "../i18n";
import { LEVELS, type LevelId } from "../levels/levels";
import type { UpgradedAnswer } from "../shared/grade";
import { countWords } from "../speech/text";

type State =
  | { kind: "running" }
  | { kind: "comparing"; answer: string }
  | { kind: "result"; answer: string; text: string }
  | { kind: "failed"; answer: string; reason: "compare" | "no-answer" };

/** Shown while an attempt runs: re-renders with the live transcript. */
function Listening({ attempt }: { attempt: RetryAttempt }) {
  const speech = useSpeech();
  return (
    <div className="space-y-2 rounded-lg bg-emerald-50 p-3">
      <RecognitionBanner speech={speech} />
      <p className="font-medium">{attempt.phase === "speaking" ? t.results.retryAsking : t.results.retryListening}</p>
      <p className="min-h-10 rounded bg-white p-2 text-slate-800" lang="en">
        {attempt.text || <span className="text-slate-300">…</span>}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg bg-emerald-700 px-4 py-2 text-white disabled:opacity-40"
          disabled={attempt.phase !== "listening"}
          onClick={() => attempt.commitNow()}
        >
          {t.results.retryDone}
        </button>
        <button type="button" className="rounded-lg px-3 py-2 text-slate-600 underline" onClick={() => attempt.cancel()}>
          {t.results.retryCancel}
        </button>
      </div>
    </div>
  );
}

export function RetryPanel({
  item,
  level,
  busy,
  onBusy,
}: {
  item: UpgradedAnswer;
  level: LevelId;
  /** Another "Reintentar" is running. */
  busy: boolean;
  onBusy: (on: boolean) => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const attemptRef = useRef<RetryAttempt | null>(null);

  useEffect(() => () => attemptRef.current?.cancel(), []);

  const start = async () => {
    // The click unlocks audio for the examiner voice and the recognizer.
    const attempt = new RetryAttempt(getSpeech(), item.question, item.part, LEVELS[level].extraPatienceMs, rerender);
    attemptRef.current = attempt;
    onBusy(true);
    setState({ kind: "running" });
    const answer = await attempt.run();
    attemptRef.current = null;
    if (countWords(answer) === 0) {
      setState({ kind: "failed", answer, reason: "no-answer" });
      onBusy(false);
      return;
    }
    setState({ kind: "comparing", answer });
    const r = await compareAttempts({ question: item.question, first: item.original, second: answer, better: item.better });
    setState(r.ok ? { kind: "result", answer, text: r.text } : { kind: "failed", answer, reason: "compare" });
    onBusy(false);
  };

  const attempt = attemptRef.current;
  return (
    <div className="space-y-2">
      {state?.kind === "running" && attempt ? (
        <Listening attempt={attempt} />
      ) : (
        <button
          type="button"
          className="rounded-lg border border-emerald-700 px-4 py-2 font-medium text-emerald-800 disabled:opacity-40"
          disabled={busy || state?.kind === "comparing"}
          onClick={() => void start()}
        >
          {state ? t.results.retryAgain : t.results.retry}
        </button>
      )}
      {state && state.kind !== "running" && state.answer && (
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">{t.results.retryYours}</div>
          <p lang="en">{state.answer}</p>
        </div>
      )}
      {state?.kind === "comparing" && <p className="text-slate-600">{t.results.retryComparing}</p>}
      {state?.kind === "result" && <p className="rounded-lg bg-sky-50 p-3 whitespace-pre-line text-sky-950">{state.text}</p>}
      {state?.kind === "failed" && (
        <p className="text-amber-800">{state.reason === "no-answer" ? t.results.retryNoAnswer : t.results.retryFailed}</p>
      )}
    </div>
  );
}
