import { describe, expect, it } from "vitest";
import { conditionsLevel, DEFAULT_LEVEL, LEVELS } from "./levels";

describe("levels", () => {
  it("match the SPEC 7 table", () => {
    expect([LEVELS[1].rate, LEVELS[2].rate, LEVELS[3].rate]).toEqual([0.85, 0.9, 1.0]);
    expect([LEVELS[1].part2PrepMs, LEVELS[2].part2PrepMs, LEVELS[3].part2PrepMs]).toEqual([120_000, 90_000, 60_000]);
    expect([LEVELS[1].part2GoalMs, LEVELS[2].part2GoalMs, LEVELS[3].part2GoalMs]).toEqual([60_000, 90_000, 120_000]);
    expect([LEVELS[1].extraPatienceMs, LEVELS[2].extraPatienceMs, LEVELS[3].extraPatienceMs]).toEqual([1_000, 500, 0]);
    expect([LEVELS[1].help, LEVELS[2].help, LEVELS[3].help]).toEqual([true, true, false]);
    expect([LEVELS[1].upgradeBand, LEVELS[2].upgradeBand, LEVELS[3].upgradeBand]).toEqual([6, 7, 7.5]);
    expect(LEVELS[3].clinicalDifficulties).toEqual([2, 3]);
  });

  it("start at Nivel 2 before placement", () => {
    expect(DEFAULT_LEVEL).toBe(2);
  });

  it("run a full test at Nivel 3 whatever the level", () => {
    expect(conditionsLevel("full", 1)).toBe(3);
    expect(conditionsLevel("full", 2)).toBe(3);
    expect(conditionsLevel("part1", 1)).toBe(1);
    expect(conditionsLevel("quick", 2)).toBe(2);
  });
});
