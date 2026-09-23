// Percentiles for the latency budget (SPEC 3). Pure.

/** Nearest-rank percentile; p in [0, 100]. Returns null for no data. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
}

export interface Summary {
  n: number;
  p50: number | null;
  p95: number | null;
  last: number | null;
}

export function summarize(values: readonly number[]): Summary {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    last: values.length ? (values[values.length - 1] ?? null) : null,
  };
}

export type BudgetStatus = "ok" | "over-target" | "over-limit" | "none";

export function budgetStatus(s: Summary, target: number, limit: number): BudgetStatus {
  if (s.p50 === null || s.p95 === null) return "none";
  if (s.p95 > limit) return "over-limit";
  if (s.p50 > target) return "over-target";
  return "ok";
}
