import { describe, expect, it } from "vitest";
import {
  effectiveSilenceMs,
  isStall,
  stallCooldownMs,
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

describe("stall back-off", () => {
  it("doubles the cooldown for stalls in a row, up to 30 s", () => {
    expect([1, 2, 3, 4, 5].map(stallCooldownMs)).toEqual([5_000, 10_000, 20_000, 30_000, 30_000]);
  });
  it("applies the streak's cooldown", () => {
    const base = { now: 20_000, voiced: true, voiceStartedAt: 0, lastResultAt: 0, lastStallAt: 12_000 };
    expect(isStall({ ...base, streak: 1 })).toBe(true); // 8 s since the last stall > 5 s
    expect(isStall({ ...base, streak: 2 })).toBe(false); // needs 10 s
  });
});

describe("effectiveSilenceMs", () => {
  it("uses the shorter of VAD silence and time since the last words", () => {
    expect(effectiveSilenceMs(3_000, 1_000)).toBe(1_000);
    expect(effectiveSilenceMs(500, 3_000)).toBe(500);
  });
  it("trusts the recognizer after 5 s without words, even if the VAD hears 'voice'", () => {
    expect(effectiveSilenceMs(0, 4_999)).toBe(0);
    expect(effectiveSilenceMs(0, 5_000)).toBe(5_000);
  });
  it("handles no VAD and no words yet", () => {
    expect(effectiveSilenceMs(null, 2_000)).toBe(2_000);
    expect(effectiveSilenceMs(1_500, Infinity)).toBe(1_500);
    expect(effectiveSilenceMs(null, Infinity)).toBe(0);
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
