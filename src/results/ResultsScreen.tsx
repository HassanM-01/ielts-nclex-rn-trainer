// Results (SPEC 13): local fluency stats at once, then the criterion bands
// as they stream in, the top 3 fixes, upgraded answers with "Reintentar",
// vocabulary with "Guardar", the Part 2 replay and the transcript. A lazy
// route, so none of this weighs on the exam screen.

import { useEffect, useState } from "react";
import { navigate } from "../app/router";
import { getSpeech, useFrameSubscription } from "../app/speech";
import { TranscriptList } from "../exam/TranscriptList";
import { currentGradeJob, isPartial, loadSavedGrade, startGrading, subscribeGrade, type GradeJob } from "../grading/grade-client";
import { gradeView } from "../grading/grade-view";
import { part2AudioUrl } from "../grading/part2-audio";
import { t } from "../i18n";
import { DEFAULT_LEVEL, type LevelId } from "../levels/levels";
import { loadCheckpoint, type ExamCheckpoint } from "../session/checkpoint";
import { getActiveExam, watchGradeJob } from "../session/exam-session";
import { FluencyTiles, GradeReport } from "./GradeReport";

/** Latency rows already recorded on this page, so re-renders don't add samples. */
const recorded = new Set<string>();

/** Grades (again) from the results screen, logging how it goes. */
function regrade(cp: ExamCheckpoint): void {
  const speech = getSpeech();
  const job = startGrading(cp, speech.recognizer.avgConfidence, { force: true });
  speech.metrics.log("grade-start", `${cp.mode} (from results): ${job.status}`);
  watchGradeJob(speech, cp);
}

/** Records "exam end → local stats on screen" once per session, after the frame paints. */
function recordOnce(key: string, name: "stats_on_screen", endedAt: number | null): void {
  if (endedAt === null || recorded.has(key)) return;
  recorded.add(key);
  requestAnimationFrame(() => getSpeech().metrics.record(name, Math.max(0, performance.now() - endedAt)));
}



function Grading({ cp, job, level }: { cp: ExamCheckpoint; job: GradeJob; level: LevelId }) {
  const view = gradeView(job.partial, job.grade);

  if (job.status === "too-short") return <p className="rounded-lg bg-amber-50 p-4 text-amber-900">{t.results.tooShort}</p>;

  return (
    <div className="space-y-4">
      {job.status === "error" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <p className="mb-2">{t.results.errors[job.failure ?? "server"]}</p>
          <button
            type="button"
            className="rounded-lg bg-slate-800 px-4 py-2 text-white"
            onClick={() => regrade(cp)}
          >
            {t.results.tryAgain}
          </button>
        </div>
      )}
      {job.status === "streaming" && view.overall === null && <p className="text-slate-600">{t.results.grading}</p>}

      <GradeReport view={view} level={level} sessionId={cp.id} pending={job.status === "streaming"} />
    </div>
  );
}

export default function ResultsScreen() {
  const [cp] = useState(() => {
    const c = loadCheckpoint();
    // A grade saved earlier shows at once, without paying for grading again.
    if (c && !currentGradeJob(c.id) && loadSavedGrade(c.id)) startGrading(c, null);
    return c;
  });
  useFrameSubscription(subscribeGrade);
  const engine = getActiveExam();
  // Only an exam that just ended on this page has an end time to measure from.
  const endedAt = cp && engine?.cp.id === cp.id ? engine.endedAt : null;

  const job = cp ? currentGradeJob(cp.id) : null;

  useEffect(() => {
    if (cp) recordOnce(`${cp.id}:stats`, "stats_on_screen", endedAt);
  }, [cp, endedAt]);
  if (!cp) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-6" lang="es">
        <p>{t.transcript.none}</p>
        <button type="button" className="underline" onClick={() => navigate("/")}>
          {t.results.backHome}
        </button>
      </main>
    );
  }

  const level: LevelId = cp.feedbackLevel ?? DEFAULT_LEVEL;
  const audio = part2AudioUrl(cp.id);

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6" lang="es">
      <header>
        <h1 className="text-2xl font-semibold">{t.results.title}</h1>
        <p className="text-sm text-slate-500">
          {t.results.modes[cp.mode] ?? cp.mode} · {new Date(cp.startedAt).toLocaleString("es-MX")}
        </p>
        {!cp.finished && <p className="mt-2 text-amber-800">{t.results.unfinished}</p>}
        {cp.finished && cp.endedEarly && <p className="mt-2 text-amber-800">{t.results.endedEarly}</p>}
        {isPartial(cp) && <p className="mt-1 text-sm text-slate-600">{t.results.partial}</p>}
      </header>

      <FluencyTiles answers={cp.answers} />

      {job && import.meta.env.DEV && job.status === "done" && (
        <button
          type="button"
          className="text-sm text-slate-500 underline"
          onClick={() => regrade(cp)}
        >
          {t.results.devRegrade}
        </button>
      )}

      {job ? (
        <Grading cp={cp} job={job} level={level} />
      ) : (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <button
            type="button"
            className="rounded-lg bg-emerald-700 px-5 py-3 font-semibold text-white"
            onClick={() => regrade(cp)}
          >
            {t.results.gradeNow}
          </button>
          <p className="mt-2 text-sm text-slate-600">{t.results.gradeNowHint}</p>
        </section>
      )}

      {audio && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">{t.results.part2Title}</h2>
          <p className="mb-2 text-sm text-slate-600">{t.results.part2Hint}</p>
          <audio controls src={audio} className="w-full" />
        </section>
      )}

      <details className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer font-medium">{t.results.transcriptTitle}</summary>
        <div className="mt-3">
          <TranscriptList cp={cp} />
        </div>
      </details>

      <button type="button" className="rounded-lg bg-slate-800 px-4 py-2 text-white" onClick={() => navigate("/")}>
        {t.results.backHome}
      </button>
    </main>
  );
}
