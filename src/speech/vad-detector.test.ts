import { describe, expect, it } from "vitest";
import { rmsToDb, VoiceDetector, type VadEvent } from "./vad-detector";

/** Feeds `db` at 30 Hz from `from` for `ms`; returns events and the end time. */
function feed(d: VoiceDetector, db: number, from: number, ms: number): { events: VadEvent[]; t: number } {
  const events: VadEvent[] = [];
  let t = from;
  for (; t < from + ms; t += 33) events.push(...d.feed(db, t).events);
  return { events, t };
}

describe("rmsToDb", () => {
  it("converts to dBFS", () => {
    expect(rmsToDb(1)).toBe(0);
    expect(rmsToDb(0.1)).toBeCloseTo(-20);
    expect(rmsToDb(0)).toBe(-120);
  });
});

describe("VoiceDetector", () => {
  it("learns the noise floor and detects voice above it", () => {
    const d = new VoiceDetector();
    let { t } = feed(d, -65, 0, 1_000);
    expect(d.floorDb).toBeLessThan(-60);
    expect(d.voiced).toBe(false);
    const on = feed(d, -25, t, 500);
    expect(on.events.map((e) => e.type)).toEqual(["voice-start"]);
    expect(d.voiced).toBe(true);
    t = on.t;
    const off = feed(d, -65, t, 600);
    expect(off.events.map((e) => e.type)).toEqual(["voice-end"]);
    expect(d.voiced).toBe(false);
  });

  it("ignores clicks shorter than the attack time", () => {
    const d = new VoiceDetector();
    const { t } = feed(d, -65, 0, 1_000);
    const click = feed(d, -20, t, 60);
    expect(click.events).toEqual([]);
    expect(feed(d, -65, click.t, 300).events).toEqual([]);
  });

  it("measures the pause between voiced stretches", () => {
    const d = new VoiceDetector();
    let { t } = feed(d, -65, 0, 1_000);
    t = feed(d, -25, t, 500).t;
    t = feed(d, -65, t, 1_500).t;
    const again = feed(d, -25, t, 300);
    const start = again.events.find((e) => e.type === "voice-start");
    expect(start?.pauseMs).toBeGreaterThan(1_400);
    expect(start?.pauseMs).toBeLessThan(1_600);
  });

  it("reports silence length", () => {
    const d = new VoiceDetector();
    let { t } = feed(d, -65, 0, 1_000);
    t = feed(d, -25, t, 500).t;
    const lastVoiced = d.lastVoicedAt;
    t = feed(d, -65, t, 1_000).t;
    expect(d.silenceMs(t)).toBeCloseTo(t - lastVoiced, -1);
  });

  it("slowly absorbs a steady loud noise instead of calling it voice forever", () => {
    const d = new VoiceDetector();
    const { t } = feed(d, -65, 0, 1_000);
    const fan = feed(d, -40, t, 120_000);
    expect(fan.events[0]?.type).toBe("voice-start");
    expect(d.voiced).toBe(false);
  });

  it("keeps the voice threshold within bounds", () => {
    const d = new VoiceDetector();
    feed(d, -100, 0, 2_000);
    expect(d.onThresholdDb).toBeGreaterThanOrEqual(-62);
  });
});
