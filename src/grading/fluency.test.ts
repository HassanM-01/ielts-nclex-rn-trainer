import { describe, expect, it } from "vitest";
import { countPauses, fluencyStats, wordsPerMinute } from "./fluency";

const m = (speakingMs: number, words: number, firstWordMs: number | null, p1 = 0, p2 = 0) => ({
  metrics: { speakingMs, words, firstWordMs, pausesOver1s: p1, pausesOver2s: p2 },
});

describe("fluency stats", () => {
  it("computes words per minute, but not from a few seconds of speech", () => {
    expect(wordsPerMinute(120, 60_000)).toBe(120);
    expect(wordsPerMinute(10, 4_000)).toBeNull();
    expect(wordsPerMinute(0, 60_000)).toBeNull();
  });

  it("sums answers with speech and takes the median time to first word", () => {
    const s = fluencyStats([m(30_000, 60, 800, 2, 1), m(90_000, 150, 1_600, 4, 2), m(0, 0, null), { metrics: null }, m(10_000, 20, 1_200)]);
    expect(s).toEqual({
      answered: 3,
      speakingMs: 130_000,
      words: 230,
      wpm: 106,
      pausesOver1s: 6,
      pausesOver2s: 3,
      firstWordMedianMs: 1_200,
    });
  });

  it("is empty but valid with no speech at all", () => {
    expect(fluencyStats([])).toMatchObject({ answered: 0, wpm: null, firstWordMedianMs: null });
  });

  it("counts pauses over 1 s and over 2 s", () => {
    expect(countPauses([500, 1_000, 1_001, 2_500, 3_000])).toEqual({ over1s: 3, over2s: 2 });
  });
});
