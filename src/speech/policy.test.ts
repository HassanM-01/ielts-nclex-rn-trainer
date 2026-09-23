import { describe, expect, it } from "vitest";
import {
  isStall,
  NetworkErrorWindow,
  restartDelayMs,
  shouldPreemptOnExaminerStart,
  shouldRestartInMonologue,
  utteranceWatchdogMs,
} from "./policy";

describe("restart policy", () => {
  it("pre-empts when the session is older than 40 s", () => {
    expect(shouldPreemptOnExaminerStart(40_000)).toBe(false);
    expect(shouldPreemptOnExaminerStart(40_001)).toBe(true);
  });
  it("restarts in the monologue at the first 700 ms pause after 45 s", () => {
    expect(shouldRestartInMonologue(44_999, 2_000)).toBe(false);
    expect(shouldRestartInMonologue(45_000, 699)).toBe(false);
    expect(shouldRestartInMonologue(45_000, 700)).toBe(true);
  });
  it("backs off only when sessions keep dying quickly", () => {
    expect(restartDelayMs(0)).toBe(0);
    expect(restartDelayMs(1)).toBe(0);
    expect(restartDelayMs(2)).toBe(250);
    expect(restartDelayMs(50)).toBe(2_000);
  });
});

describe("stall detection", () => {
  const base = { now: 10_000, voiced: true, voiceStartedAt: 6_000, lastResultAt: 5_000, lastStallAt: -Infinity };

  it("flags 3 s of voice with no result", () => {
    expect(isStall(base)).toBe(true);
    expect(isStall({ ...base, now: 8_999 })).toBe(false);
  });
  it("counts from the last result if it came during the voice", () => {
    expect(isStall({ ...base, lastResultAt: 8_000 })).toBe(false);
  });
  it("needs voice", () => {
    expect(isStall({ ...base, voiced: false })).toBe(false);
  });
  it("cools down after a stall restart", () => {
    expect(isStall({ ...base, lastStallAt: 6_000 })).toBe(false);
    expect(isStall({ ...base, lastStallAt: 4_000 })).toBe(true);
  });
});

describe("NetworkErrorWindow", () => {
  it("trips on the third error within 60 s", () => {
    const w = new NetworkErrorWindow();
    expect(w.record(0)).toBe(false);
    expect(w.record(30_000)).toBe(false);
    expect(w.record(59_999)).toBe(true);
  });
  it("forgets errors older than 60 s", () => {
    const w = new NetworkErrorWindow();
    w.record(0);
    w.record(10_000);
    expect(w.record(70_000)).toBe(false);
    expect(w.count(70_000)).toBe(1);
  });
});

describe("utteranceWatchdogMs", () => {
  it("is words x 0.5 s + 2 s", () => {
    expect(utteranceWatchdogMs("Can you tell me your full name?")).toBe(7 * 500 + 2_000);
    expect(utteranceWatchdogMs("")).toBe(2_000);
  });
});
