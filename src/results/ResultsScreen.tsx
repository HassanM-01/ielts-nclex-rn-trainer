// Results (SPEC 13): local fluency stats at once, then the criterion bands
// as they stream in, the top 3 fixes, upgraded answers with "Reintentar",
// vocabulary with "Guardar", the Part 2 replay and the transcript. A lazy
// route, so none of this weighs on the exam screen.

import { useEffect, useState } from "react";
import { navigate } from "../app/router";
import { getSpeech, useFrameSubscription } from "../app/speech";
import { TranscriptList } from "../exam/TranscriptList";
import { fluencyStats } from "../grading/fluency";
import { currentGradeJob, isPartial, loadSavedGrade, startGrading, subscribeGrade, type GradeJob } from "../grading/grade-client";
import { gradeView } from "../grading/grade-view";
import { part2AudioUrl } from "../grading/part2-audio";
import { isSaved, saveWord } from "../grading/vocab-store";
import { fill, t } from "../i18n";
import { DEFAULT_LEVEL, LEVELS, type LevelId } from "../levels/levels";
import { loadCheckpoint, type ExamCheckpoint } from "../session/checkpoint";
import { getActiveExam, watchGradeJob } from "../session/exam-session";
import { CRITERIA, type Criterion, type VocabItem } from "../shared/grade";
import { RetryPanel } from "./RetryPanel";

const TARGET_BAND = 7;
/** Latency rows already recorded on this page, so re-renders don't add samples. */
const recorded = new Set<string>();

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Grades (again) from the results screen, logging how it goes. */
function regrade(cp: ExamCheckpoint): void {
  const speech = getSpeech();
  const job = startGrading(cp, speech.recognizer.avgConfidence, { force: true });
  speech.metrics.log("grade-start", `${cp.mode} (from results): ${job.status}`);
  watchGradeJob(speech, cp.id);
}

function band(n: number): string {
  return n.toFixed(1);
}

/** Records "exam end → local stats on screen" once per session, after the frame paints. */
function recordOnce(key: string, name: "stats_on_screen", endedAt: number | null): void {
  if (endedAt === null || recorded.has(key)) return;
  recorded.add(key);
  requestAnimationFrame(() => getSpeech().metrics.record(name, Math.max(0, performance.now() - endedAt)));
}

function Stats({ cp }: { cp: ExamCheckpoint }) {
  const s = fluencyStats(cp.answers.filter((a) => a.part >= 1));
  const tiles: [string, string][] = [
    [t.results.stats.speaking, s.speakingMs > 0 ? clock(s.speakingMs) : t.results.stats.none],
    [t.results.stats.wpm, s.wpm !== null ? String(s.wpm) : t.results.stats.none],
    [t.results.stats.longPauses, String(s.pausesOver2s)],
    [t.results.stats.firstWord, s.firstWordMedianMs !== null ? `${(s.firstWordMedianMs / 1000).toFixed(1)} s` : t.results.stats.none],
  ];
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 font-semibold">{t.results.statsTitle}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 p-3">
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="font-mono text-2xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CriterionCard({ name, c }: { name: string; c: Criterion | null }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-semibold">{name}</h3>
        {c ? (
          <span className="font-mono text-2xl font-semibold text-sky-800">
            {t.results.band} {c.band}
          </span>
        ) : (
          <span className="animate-pulse text-sm text-slate-400">{t.results.pending}</span>
        )}
      </div>
      {c && (
        <>
          {c.evidence.length > 0 && (
            <>
              <div className="mt-2 text-xs text-slate-500">{t.results.evidence}</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700" lang="en">
                {c.evidence.map((e, i) => (
                  <li key={i}>“{e}”</li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-2 text-xs text-slate-500">{t.results.advice}</div>
          <p className="text-slate-900">{c.advice_es}</p>
        </>
      )}
    </section>
  );
}

function VocabRow({ item, sessionId }: { item: VocabItem; sessionId: string }) {
  const [state, setState] = useState<"idle" | "saved" | "failed">(isSaved(item.word) ? "saved" : "idle");
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <div>
        <span className="font-semibold" lang="en">
          {item.word}
        </span>
        <span className="text-slate-600"> · {item.es}</span>
        <p className="text-sm text-slate-600 italic" lang="en">
          {item.example}
        </p>
      </div>
      <button
        type="button"
        className="rounded-lg border border-slate-300 px-3 py-1 text-sm disabled:border-emerald-600 disabled:text-emerald-700"
        disabled={state === "saved"}
        onClick={() => setState(saveWord(item, sessionId) ? "saved" : "failed")}
      >
        {state === "saved" ? t.results.saved : state === "failed" ? t.results.saveFailed : t.results.save}
      </button>
    </li>
  );
}

function Grading({ cp, job, level }: { cp: ExamCheckpoint; job: GradeJob; level: LevelId }) {
  const [retrying, setRetrying] = useState(false);
  const view = gradeView(job.partial, job.grade);
  const upgradeBand = String(LEVELS[level].upgradeBand);

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

      {view.overall !== null && (
        <section className="rounded-lg border-2 border-sky-700 bg-sky-50 p-4 text-center">
          <div className="font-mono text-5xl font-bold text-sky-900">{band(view.overall)}</div>
          <div className="font-medium text-sky-900">{t.results.overall}</div>
          <div className="text-sm text-slate-600">
            {view.overall >= TARGET_BAND ? t.results.atTarget : fill(t.results.toTarget, { n: band(TARGET_BAND - view.overall) })}
          </div>
        </section>
      )}

      {job.status !== "error" &&
        CRITERIA.map((k) => <CriterionCard key={k} name={t.results.criteria[k]} c={view.criteria[k]} />)}

      {view.fixes && view.fixes.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">{t.results.fixesTitle}</h2>
          <ol className="list-decimal space-y-1 pl-5">
            {view.fixes.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ol>
          {view.focus && (
            <p className="mt-3 rounded bg-emerald-50 p-2">
              <span className="font-medium">{t.results.focusTitle}: </span>
              {view.focus}
            </p>
          )}
        </section>
      )}

      {view.pronunciation && (view.pronunciation.flagged.length > 0 || view.pronunciation.note_es) && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">{t.results.pronunciationTitle}</h2>
          <p className="mb-2 text-sm text-slate-600">{t.results.pronunciationHint}</p>
          {view.pronunciation.flagged.length > 0 && (
            <ul className="mb-2 space-y-1">
              {view.pronunciation.flagged.map((f, i) => (
                <li key={i}>
                  {t.results.heard}: <span lang="en">“{f.heard}”</span> → {t.results.likely}: <span lang="en">“{f.likely}”</span>
                </li>
              ))}
            </ul>
          )}
          {view.pronunciation.note_es && <p>{view.pronunciation.note_es}</p>}
        </section>
      )}

      {view.upgraded && view.upgraded.length > 0 && (
        <section className="space-y-3">
          <div>
            <h2 className="font-semibold">{t.results.upgradedTitle}</h2>
            <p className="text-sm text-slate-600">{fill(t.results.upgradedHint, { band: upgradeBand })}</p>
          </div>
          {view.upgraded.map((u, i) => (
            <article key={i} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-500">{t.transcript.partLabel[u.part] ?? ""}</div>
              <div className="font-medium text-sky-800" lang="en">
                {u.question}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">{t.results.original}</div>
                  <p lang="en">{u.original}</p>
                </div>
                <div className="rounded-lg bg-emerald-50 p-3">
                  <div className="text-xs text-emerald-800">{fill(t.results.better, { band: upgradeBand })}</div>
                  <p lang="en">{u.better}</p>
                </div>
              </div>
              <p className="text-sm text-slate-700">{u.why_es}</p>
              <RetryPanel item={u} level={level} busy={retrying} onBusy={setRetrying} />
            </article>
          ))}
        </section>
      )}

      {view.vocab && view.vocab.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-1 font-semibold">{t.results.vocabTitle}</h2>
          <ul>
            {view.vocab.map((v) => (
              <VocabRow key={v.word} item={v} sessionId={cp.id} />
            ))}
          </ul>
        </section>
      )}
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

      <Stats cp={cp} />

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
