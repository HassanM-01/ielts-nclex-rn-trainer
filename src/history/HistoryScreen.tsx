// History (SPEC 12): the sessions with their overall band and level, a
// line chart of full tests against the 7.0 target, and a tap-in view to
// reread a session's transcript and feedback. A lazy route.

import { useEffect, useState } from "react";
import { navigate } from "../app/router";
import { TranscriptList } from "../exam/TranscriptList";
import { gradeView } from "../grading/grade-view";
import { fill, t } from "../i18n";
import { DEFAULT_LEVEL } from "../levels/levels";
import { api } from "../persistence/api";
import { band, GradeReport } from "../results/GradeReport";
import type { HistoryRow, HistorySession } from "../shared/persistence-api";
import { chartLayout, type SeriesKey } from "./chart";

type Load<T> = { state: "loading" } | { state: "error" } | { state: "not-found" } | { state: "ok"; data: T };

function useApi<T>(path: string): [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    void api<T>(path).then((r) => {
      if (!live) return;
      setLoad(r.ok ? { state: "ok", data: r.data } : r.status === 404 ? { state: "not-found" } : { state: "error" });
    });
    return () => {
      live = false;
    };
  }, [path, n]);
  return [load, () => setN((x) => x + 1)];
}

const SERIES: { key: SeriesKey; label: string; className: string }[] = [
  { key: "overall", label: t.history.legendOverall, className: "stroke-sky-800" },
  { key: "fc", label: t.results.criteria.fluency_coherence, className: "stroke-emerald-600" },
  { key: "lr", label: t.results.criteria.lexical_resource, className: "stroke-amber-600" },
  { key: "gr", label: t.results.criteria.grammatical_range, className: "stroke-rose-600" },
];

function Chart({ rows }: { rows: HistoryRow[] }) {
  const c = chartLayout(rows);
  if (!c.points.length && !c.practice.length) return null;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">{t.history.chartTitle}</h2>
      <p className="mb-2 text-sm text-slate-600">{t.history.chartHint}</p>
      <svg viewBox={`0 0 ${c.width} ${c.height}`} className="h-auto w-full" role="img" aria-label={t.history.chartTitle}>
        {c.bandY.map((b) => (
          <g key={b.band}>
            <line x1={28} x2={c.width - 12} y1={b.y} y2={b.y} className="stroke-slate-100" />
            <text x={20} y={b.y + 4} textAnchor="end" className="fill-slate-400 text-[10px]">
              {b.band}
            </text>
          </g>
        ))}
        <line x1={28} x2={c.width - 12} y1={c.targetY} y2={c.targetY} className="stroke-emerald-700" strokeDasharray="6 4" strokeWidth={1.5} />
        {/* The overall last, so it stays on top where the lines meet. */}
        {[...SERIES].reverse().map((s) =>
          c.lines[s.key] ? (
            <polyline key={s.key} points={c.lines[s.key]} fill="none" className={s.className} strokeWidth={s.key === "overall" ? 3 : 1.5} />
          ) : null,
        )}
        {c.points.map((p) => (
          <circle key={p.id} cx={p.x} cy={p.y} r={4} className="fill-sky-800" />
        ))}
        {c.practice.map((p) => (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r={4} className="fill-white stroke-slate-500" strokeWidth={1.5} />
            <text x={p.x + 6} y={p.y - 6} className="fill-slate-500 text-[10px]">
              {fill(t.history.levelShort, { n: String(p.level) })}
            </text>
          </g>
        ))}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1">
            <svg width="16" height="6" aria-hidden="true">
              <line x1="0" x2="16" y1="3" y2="3" className={s.className} strokeWidth={s.key === "overall" ? 3 : 1.5} />
            </svg>
            {s.label}
          </li>
        ))}
        <li className="flex items-center gap-1">
          <svg width="16" height="6" aria-hidden="true">
            <line x1="0" x2="16" y1="3" y2="3" className="stroke-emerald-700" strokeDasharray="4 3" strokeWidth={1.5} />
          </svg>
          {t.history.legendTarget}
        </li>
        <li className="flex items-center gap-1">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="3.5" className="fill-white stroke-slate-500" strokeWidth={1.5} />
          </svg>
          {t.history.practice}
        </li>
      </ul>
    </section>
  );
}

function Failed({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
      <p className="mb-2">{message}</p>
      <button type="button" className="rounded-lg bg-slate-800 px-4 py-2 text-white" onClick={retry}>
        {t.history.retry}
      </button>
    </div>
  );
}

function List() {
  const [load, reload] = useApi<HistoryRow[]>("/api/history");
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6" lang="es">
      <h1 className="text-2xl font-semibold">{t.history.title}</h1>
      {load.state === "loading" && <p className="text-slate-500">{t.history.loading}</p>}
      {(load.state === "error" || load.state === "not-found") && <Failed message={t.history.error} retry={reload} />}
      {load.state === "ok" && load.data.length === 0 && <p className="text-slate-600">{t.history.empty}</p>}
      {load.state === "ok" && load.data.length > 0 && (
        <>
          <Chart rows={load.data} />
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {load.data.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left hover:bg-slate-50"
                  onClick={() => navigate(`/historial/${r.id}`)}
                >
                  <span>
                    <span className="font-medium">{t.results.modes[r.mode] ?? r.mode}</span>
                    <span className="text-sm text-slate-500"> · {new Date(r.startedAt).toLocaleString("es-MX")}</span>
                    {r.mode !== "full" && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs text-slate-600">{fill(t.history.levelShort, { n: String(r.level) })}</span>}
                  </span>
                  <span className="font-mono text-lg font-semibold text-sky-900">{r.overall !== null ? band(r.overall) : <span className="font-sans text-sm font-normal text-slate-400">{t.history.notGraded}</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <button type="button" className="rounded-lg bg-slate-800 px-4 py-2 text-white" onClick={() => navigate("/")}>
        {t.history.backHome}
      </button>
    </main>
  );
}

function Detail({ id }: { id: string }) {
  const [load, reload] = useApi<HistorySession>(`/api/history?id=${encodeURIComponent(id)}`);
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6" lang="es">
      <button type="button" className="text-slate-600 underline" onClick={() => navigate("/historial")}>
        {t.history.back}
      </button>
      {load.state === "loading" && <p className="text-slate-500">{t.history.loading}</p>}
      {load.state === "error" && <Failed message={t.history.error} retry={reload} />}
      {load.state === "not-found" && <p>{t.history.notFound}</p>}
      {load.state === "ok" && (
        <>
          <header>
            <h1 className="text-2xl font-semibold">{t.results.modes[load.data.mode] ?? load.data.mode}</h1>
            <p className="text-sm text-slate-500">{new Date(load.data.startedAt).toLocaleString("es-MX")}</p>
          </header>
          {load.data.grade ? (
            <div className="space-y-4">
              <GradeReport
                view={gradeView({ value: undefined, complete: false, closedKeys: [] }, load.data.grade)}
                level={load.data.transcript.feedbackLevel ?? DEFAULT_LEVEL}
                sessionId={load.data.id}
                pending={false}
              />
            </div>
          ) : (
            <p className="text-slate-600">{t.history.notGraded}</p>
          )}
          <details className="rounded-lg border border-slate-200 bg-slate-50 p-4" open={!load.data.grade}>
            <summary className="cursor-pointer font-medium">{t.results.transcriptTitle}</summary>
            <div className="mt-3">
              <TranscriptList cp={load.data.transcript} />
            </div>
          </details>
        </>
      )}
    </main>
  );
}

export default function HistoryScreen({ id }: { id: string | null }) {
  return id ? <Detail id={id} /> : <List />;
}
