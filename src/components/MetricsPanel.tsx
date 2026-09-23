// Latency and speech telemetry table (debug overlay and /lab). Developer
// tool, so English.

import { useState } from "react";
import type { Metrics } from "../metrics/latency";
import type { BudgetStatus } from "../metrics/stats";

const STATUS_CLASS: Record<BudgetStatus, string> = {
  ok: "text-emerald-700",
  "over-target": "text-amber-700",
  "over-limit": "text-rose-700 font-semibold",
  none: "text-slate-500",
};

export function MetricsPanel({ metrics, compact = false }: { metrics: Metrics; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const rows = metrics.rows().filter((r) => !compact || r.n > 0 || r.target !== null);
  const counters = Object.entries(metrics.getCounters()).sort(([a], [b]) => a.localeCompare(b));
  const info = Object.entries(metrics.getInfo());

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(metrics.report());
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="text-xs">
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1 pr-2 font-medium">Latency (ms)</th>
            <th className="px-1 font-medium">n</th>
            <th className="px-1 font-medium">p50</th>
            <th className="px-1 font-medium">p95</th>
            <th className="px-1 font-medium">last</th>
            <th className="px-1 font-medium">target / limit</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((r) => (
            <tr key={r.name} className={`border-t border-slate-200 ${STATUS_CLASS[r.status]}`}>
              <td className="py-1 pr-2 font-sans">{r.label}</td>
              <td className="px-1">{r.n}</td>
              <td className="px-1">{r.p50 ?? "–"}</td>
              <td className="px-1">{r.p95 ?? "–"}</td>
              <td className="px-1">{r.last ?? "–"}</td>
              <td className="px-1">{r.target !== null ? `${r.target} / ${r.limit}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <dl>
          <dt className="mb-1 font-medium text-slate-500">Counters</dt>
          {counters.length === 0 && <dd className="text-slate-400">none yet</dd>}
          {counters.map(([k, v]) => (
            <dd key={k} className="flex justify-between gap-2 font-mono">
              <span>{k}</span>
              <span>{v}</span>
            </dd>
          ))}
        </dl>
        <dl>
          <dt className="mb-1 font-medium text-slate-500">Engine and voice</dt>
          {info.map(([k, v]) => (
            <dd key={k} className="flex justify-between gap-2 font-mono">
              <span>{k}</span>
              <span className="truncate text-right" title={String(v)}>
                {String(v)}
              </span>
            </dd>
          ))}
        </dl>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy report"}
        </button>
        <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1" onClick={() => metrics.reset()}>
          Reset numbers
        </button>
      </div>
    </div>
  );
}
