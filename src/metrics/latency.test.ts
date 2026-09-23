import { afterEach, describe, expect, it, vi } from "vitest";
import { Metrics } from "./latency";

describe("Metrics", () => {
  it("summarizes latency against the budget", () => {
    const m = new Metrics();
    [150, 200, 250].forEach((ms) => m.record("commit_to_audio_scripted", ms));
    const row = m.rows().find((r) => r.name === "commit_to_audio_scripted");
    expect([row?.n, row?.p50, row?.status]).toEqual([3, 200, "ok"]);
  });

  it("ignores negative and non-finite samples", () => {
    const m = new Metrics();
    m.record("tts_start", -5);
    m.record("tts_start", Number.NaN);
    expect(m.rows().find((r) => r.name === "tts_start")?.n).toBe(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps counters and events across a reload, with wall-clock times", () => {
    vi.useFakeTimers();
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    const a = new Metrics("m");
    a.count("stalls");
    a.log("stall", "voice for 3 s with no text in turn #4; restarting");
    vi.advanceTimersByTime(1_100); // persist is debounced
    const b = new Metrics("m");
    expect(b.getCounters()).toEqual({ stalls: 1 });
    expect(b.report()).toMatch(/\d\d:\d\d:\d\d stall: voice for 3 s/);
  });

  it("puts notable events in the copyable report, not routine ones", () => {
    const m = new Metrics();
    m.log("stall", "voice for 3 s with no text; restarting");
    m.log("mic-change", "Laptop mic → Headset mic (devicechange)");
    m.log("tts-line-start", "line 1");
    const report = m.report();
    expect(report).toContain("stall: voice for 3 s");
    expect(report).toContain("mic-change: Laptop mic → Headset mic");
    expect(report).not.toContain("tts-line-start");
  });
});
