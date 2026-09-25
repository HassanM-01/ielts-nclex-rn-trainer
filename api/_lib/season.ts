// Season windows (SPEC 9, "Seasonal bank"). Prep sites track the reported
// question pool in three seasons: January–April, May–August,
// September–December. A season id is its first month: "2026-09".

import type { BankFile } from "../../src/exams/bank";

/** The UTC interval a season file covers, or null for evergreen/invalid. */
export function seasonWindow(file: Pick<BankFile, "season" | "ends">): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(file.season);
  if (!m || !file.ends) return null;
  const start = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  const end = new Date(`${file.ends}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { start, end };
}

export function inSeason(file: Pick<BankFile, "season" | "ends">, date: Date): boolean {
  const w = seasonWindow(file);
  return !!w && date >= w.start && date <= w.end;
}

/**
 * The season file to practise from: the one containing Julio's IELTS test
 * date if it exists, else the current season. A file past its `ends` date is
 * never used (its share moves to evergreen general).
 */
export function pickSeason<F extends Pick<BankFile, "season" | "ends">>(files: readonly F[], now: Date, testDate: Date | null = null): F | null {
  const current = files.filter((f) => {
    const w = seasonWindow(f);
    return !!w && w.end >= now;
  });
  if (testDate) {
    const forTest = current.find((f) => inSeason(f, testDate));
    if (forTest) return forTest;
  }
  return current.find((f) => inSeason(f, now)) ?? null;
}
