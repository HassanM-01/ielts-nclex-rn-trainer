import { describe, expect, it } from "vitest";
import { fullBank } from "../../scripts/bank/test-fixtures";
import { inSeason, pickSeason, seasonWindow } from "./season";
import { selectItems } from "./select";

const SEP = new Date("2026-09-25T12:00:00Z");

/** Deterministic random: cycles through the given values. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe("season windows", () => {
  const s = { season: "2026-09", ends: "2026-12-31" };
  it("covers the first day of the start month to the end date", () => {
    expect(seasonWindow(s)?.start.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(inSeason(s, new Date("2026-12-31T20:00:00Z"))).toBe(true);
    expect(inSeason(s, new Date("2027-01-01T00:00:00Z"))).toBe(false);
    expect(seasonWindow({ season: "evergreen", ends: null })).toBeNull();
  });

  it("prefers the season of the test date, else the current one; never a past one", () => {
    const next = { season: "2027-01", ends: "2027-04-30" };
    expect(pickSeason([s, next], SEP)).toBe(s);
    expect(pickSeason([s, next], SEP, new Date("2027-02-10"))).toBe(next);
    expect(pickSeason([s, next], SEP, new Date("2027-06-10"))).toBe(s);
    expect(pickSeason([s], new Date("2027-01-15"))).toBeNull();
  });
});

describe("selectItems", () => {
  const bank = fullBank();

  it("returns 3 Part 1 topics (opening first), a card and its linked Part 3 set", () => {
    const sel = selectItems(bank, { now: SEP, random: seq(0.1, 0.3, 0.5, 0.7, 0.9) })!;
    expect(sel.season).toBe("2026-09");
    expect(sel.items.part1).toHaveLength(3);
    expect(sel.items.part1[0]!.opening).toBe(true);
    expect(sel.items.part1.slice(1).every((t) => t.id.startsWith("p1-season-"))).toBe(true);
    expect(sel.items.part3!.id).toBe(sel.items.part2.id.replace("p2-", "p3-"));
  });

  it("picks Work as the opening topic about half the time", () => {
    let work = 0;
    for (let i = 0; i < 400; i++) {
      const sel = selectItems(bank, { now: SEP, random: Math.random })!;
      if (sel.items.part1[0]!.id === "p1-work") work++;
    }
    expect(work / 400).toBeGreaterThan(0.4);
    expect(work / 400).toBeLessThan(0.6);
  });

  it("draws cards about 60% season, 25% health, 15% evergreen", () => {
    const counts = { season: 0, health: 0, ever: 0 };
    const n = 2_000;
    for (let i = 0; i < n; i++) {
      const id = selectItems(bank, { now: SEP })!.items.part2.id;
      if (id.startsWith("p2-season")) counts.season++;
      else if (id.startsWith("p2-health")) counts.health++;
      else counts.ever++;
    }
    expect(counts.season / n).toBeGreaterThan(0.54);
    expect(counts.season / n).toBeLessThan(0.66);
    expect(counts.health / n).toBeGreaterThan(0.2);
    expect(counts.health / n).toBeLessThan(0.3);
    expect(counts.ever / n).toBeGreaterThan(0.1);
    expect(counts.ever / n).toBeLessThan(0.2);
  });

  it("moves the season's share to evergreen once the season is over", () => {
    for (let i = 0; i < 200; i++) {
      const sel = selectItems(bank, { now: new Date("2027-01-10T12:00:00Z") })!;
      expect(sel.season).toBeNull();
      expect(sel.items.part2.id.startsWith("p2-season")).toBe(false);
      expect(sel.items.part1.slice(1).every((t) => t.id.startsWith("p1-ever-"))).toBe(true);
    }
  });

  it("skips recent topics and cards when history is given", () => {
    const recent2 = bank.flatMap((f) => f.part2.map((c) => c.id)).filter((id) => id !== "p2-season-3");
    for (let i = 0; i < 50; i++) {
      const sel = selectItems(bank, { now: SEP, recent: { part2: recent2, part1: ["p1-work", "p1-home"] } })!;
      expect(sel.items.part2.id).toBe("p2-season-3");
      expect(sel.items.part1[0]!.id).toBe("p1-hometown");
    }
  });

  it("returns null when the bank is empty", () => {
    expect(selectItems([], { now: SEP })).toBeNull();
  });
});
