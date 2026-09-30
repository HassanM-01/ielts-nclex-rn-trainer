// The grade as shown on the results screen and in History (SPEC 13): the
// overall, the three criteria, fixes and focus, pronunciation flags,
// upgraded answers with "Reintentar", and vocabulary with "Guardar". Also
// the local fluency tiles.

import { useState } from "react";
import { fluencyStats } from "../grading/fluency";
import type { GradeView } from "../grading/grade-view";
import { isSaved, saveWord } from "../grading/vocab-store";
import { fill, t } from "../i18n";
import { LEVELS, type LevelId } from "../levels/levels";
import { CRITERIA, type AnswerMetrics, type Criterion, type VocabItem } from "../shared/grade";
import { RetryPanel } from "./RetryPanel";

export const TARGET_BAND = 7;

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function band(n: number): string {
  return n.toFixed(1);
}

export function FluencyTiles({ answers }: { answers: readonly { part: number; metrics?: AnswerMetrics | null }[] }) {
  const s = fluencyStats(answers.filter((a) => a.part >= 1));
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

/**
 * `pending`: grading is still streaming, so criteria not in yet show
 * "Calificando…". `retry`: offer "Reintentar" on the upgraded answers.
 */
export function GradeReport({ view, level, sessionId, pending, retry = true }: { view: GradeView; level: LevelId; sessionId: string; pending: boolean; retry?: boolean }) {
  const [retrying, setRetrying] = useState(false);
  const upgradeBand = String(LEVELS[level].upgradeBand);
  return (
    <>
      {view.overall !== null && (
        <section className="rounded-lg border-2 border-sky-700 bg-sky-50 p-4 text-center">
          <div className="font-mono text-5xl font-bold text-sky-900">{band(view.overall)}</div>
          <div className="font-medium text-sky-900">{t.results.overall}</div>
          <div className="text-sm text-slate-600">
            {view.overall >= TARGET_BAND ? t.results.atTarget : fill(t.results.toTarget, { n: band(TARGET_BAND - view.overall) })}
          </div>
        </section>
      )}

      {CRITERIA.map((k) => (view.criteria[k] || pending ? <CriterionCard key={k} name={t.results.criteria[k]} c={view.criteria[k]} /> : null))}

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
              {retry && <RetryPanel item={u} level={level} busy={retrying} onBusy={setRetrying} />}
            </article>
          ))}
        </section>
      )}

      {view.vocab && view.vocab.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-1 font-semibold">{t.results.vocabTitle}</h2>
          <ul>
            {view.vocab.map((v) => (
              <VocabRow key={v.word} item={v} sessionId={sessionId} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
