// After the exam (step 2 stand-in for the results screen of step 5): the
// transcript by part and question, from the saved checkpoint.

import { navigate } from "../app/router";
import { t } from "../i18n";
import { loadCheckpoint } from "../session/checkpoint";

export function TranscriptScreen() {
  const cp = loadCheckpoint();

  if (!cp) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6" lang="es">
        <p>{t.transcript.none}</p>
        <button type="button" className="underline" onClick={() => navigate("/")}>
          {t.transcript.backHome}
        </button>
      </main>
    );
  }

  const answers = cp.answers.filter((a) => a.outcome !== null);

  return (
    <main className="mx-auto max-w-2xl space-y-4 p-6" lang="es">
      <h1 className="text-2xl font-semibold">{t.transcript.title}</h1>
      <p className="text-sm text-slate-500">{new Date(cp.startedAt).toLocaleString("es-MX")}</p>
      {(cp.endedEarly || !cp.finished) && <p className="text-amber-800">{t.transcript.unfinished}</p>}
      <p className="text-slate-600">{t.transcript.gradingSoon}</p>

      <ol className="space-y-3">
        {answers.map((a) => (
          <li key={a.stepId} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs text-slate-500">{t.transcript.partLabel[a.part] ?? ""}</div>
            <div className="font-medium text-sky-800" lang="en">
              {a.question}
            </div>
            <p className="mt-1" lang="en">
              {a.text || <span className="text-slate-400">{t.transcript.noAnswer}</span>}
            </p>
            <div className="mt-1 space-x-3 text-xs text-slate-500">
              {a.outcome === "time-limit" && <span>{t.transcript.timeLimit}</span>}
              {a.outcome === "hard-stop" && <span>{t.transcript.hardStop}</span>}
              {a.outcome === "ended" && <span>{t.transcript.ended}</span>}
              {a.backupPrompt && <span>{t.transcript.backupPrompt}</span>}
              {a.repeats > 0 && (
                <span>
                  {t.transcript.repeated} ×{a.repeats}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>

      {cp.notes && (
        <section>
          <h2 className="mb-1 font-medium">{t.transcript.notes}</h2>
          <p className="rounded-lg bg-white p-3 whitespace-pre-wrap">{cp.notes}</p>
        </section>
      )}

      <button type="button" className="rounded-lg bg-slate-800 px-4 py-2 text-white" onClick={() => navigate("/")}>
        {t.transcript.backHome}
      </button>
    </main>
  );
}
