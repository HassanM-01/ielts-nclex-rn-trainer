// The transcript by part and question, with notes such as "interrupted for
// time". Shown on the results screen (it replaced the step 2 transcript page).

import { t } from "../i18n";
import type { ExamCheckpoint } from "../session/checkpoint";

export function TranscriptList({ cp }: { cp: ExamCheckpoint }) {
  const answers = cp.answers.filter((a) => a.outcome !== null);
  return (
    <div className="space-y-3">
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
          <h3 className="mb-1 font-medium">{t.transcript.notes}</h3>
          <p className="rounded-lg bg-white p-3 whitespace-pre-wrap">{cp.notes}</p>
        </section>
      )}
    </div>
  );
}
