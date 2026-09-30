// History chart (SPEC 12): lines for the overall and each criterion, drawn
// from graded full tests only, with a 7.0 target line; graded practice
// sessions appear as separate dots marked with their level. Pure: rows in,
// SVG coordinates out, so the History route needs no chart library.

import type { HistoryRow } from "../shared/persistence-api";

export type SeriesKey = "overall" | "fc" | "lr" | "gr";

export interface ChartLayout {
  width: number;
  height: number;
  /** "x,y x,y ..." for each line; empty when there are no full tests. */
  lines: Record<SeriesKey, string>;
  /** Full-test points (the overall), for markers. */
  points: { id: string; x: number; y: number; value: number }[];
  practice: { id: string; x: number; y: number; value: number; level: number }[];
  /** y of the 7.0 target line and of each band label from 0 to 9. */
  targetY: number;
  bandY: { band: number; y: number }[];
}

export const TARGET = 7;
const PAD = { left: 28, right: 12, top: 10, bottom: 10 };

export function chartLayout(rows: readonly HistoryRow[], width = 640, height = 240): ChartLayout {
  const graded = rows.filter((r) => r.exam === "ielts" && r.overall !== null).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const times = graded.map((r) => Date.parse(r.startedAt));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const x = (t: number) => PAD.left + (t1 > t0 ? ((t - t0) / (t1 - t0)) * innerW : innerW / 2);
  const y = (band: number) => PAD.top + (1 - band / 9) * innerH;
  const round = (n: number) => Math.round(n * 10) / 10;

  const full = graded.filter((r) => r.mode === "full");
  const line = (value: (r: HistoryRow) => number | undefined) =>
    full
      .flatMap((r) => {
        const v = value(r);
        return v === undefined ? [] : [`${round(x(Date.parse(r.startedAt)))},${round(y(v))}`];
      })
      .join(" ");

  return {
    width,
    height,
    lines: {
      overall: line((r) => r.overall ?? undefined),
      fc: line((r) => r.bands?.fc),
      lr: line((r) => r.bands?.lr),
      gr: line((r) => r.bands?.gr),
    },
    points: full.map((r) => ({ id: r.id, x: round(x(Date.parse(r.startedAt))), y: round(y(r.overall!)), value: r.overall! })),
    practice: graded
      .filter((r) => r.mode !== "full")
      .map((r) => ({ id: r.id, x: round(x(Date.parse(r.startedAt))), y: round(y(r.overall!)), value: r.overall!, level: r.level })),
    targetY: round(y(TARGET)),
    bandY: Array.from({ length: 10 }, (_, b) => ({ band: b, y: round(y(b)) })),
  };
}
