import { describe, expect, it } from "vitest";
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
