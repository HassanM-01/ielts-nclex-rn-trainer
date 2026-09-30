import { describe, expect, it } from "vitest";
import type { HistoryRow } from "../shared/persistence-api";
import { chartLayout } from "./chart";

const row = (id: string, day: number, mode: string, overall: number | null, level: 1 | 2 | 3 = 3): HistoryRow => ({
  id,
  startedAt: `2026-10-${String(day).padStart(2, "0")}T15:00:00.000Z`,
  exam: "ielts",
  mode,
  level,
  overall,
  bands: overall === null ? null : { fc: overall, lr: overall + 1, gr: overall - 1 },
});

// W 640, H 240, padding left 28 right 12 top 10 bottom 10: x from 28 to 628, y from 230 (band 0) to 10 (band 9).
describe("chartLayout", () => {
  it("draws full tests only as lines, oldest to newest", () => {
    const c = chartLayout([row("b", 3, "full", 6), row("a", 1, "full", 4.5), row("p", 2, "part1", 5, 2), row("u", 4, "full", null)]);
    expect(c.lines.overall).toBe("28,120 628,83.3");
    expect(c.lines.lr).toBe("28,95.6 628,58.9");
    expect(c.points.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("marks practice sessions as dots with their level", () => {
    const c = chartLayout([row("a", 1, "full", 4.5), row("p", 2, "parts23", 5, 2), row("b", 3, "full", 6)]);
    expect(c.practice).toEqual([{ id: "p", x: 328, y: 107.8, value: 5, level: 2 }]);
  });

  it("puts the 7.0 target line and the band scale in place", () => {
    const c = chartLayout([row("a", 1, "full", 5)]);
    expect(c.targetY).toBe(58.9);
    expect(c.bandY[0]).toEqual({ band: 0, y: 230 });
    expect(c.bandY[9]).toEqual({ band: 9, y: 10 });
    // A single session sits in the middle.
    expect(c.points[0]?.x).toBe(328);
  });

  it("is empty without graded sessions", () => {
    const c = chartLayout([row("u", 1, "full", null)]);
    expect(c.lines.overall).toBe("");
    expect(c.points).toEqual([]);
    expect(c.practice).toEqual([]);
  });
});
