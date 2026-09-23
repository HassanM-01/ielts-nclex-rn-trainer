import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Recognizer, type RecognizerCallbacks } from "./recognizer";
import { TranscriptBuffer } from "./transcript";

// A scriptable stand-in for webkitSpeechRecognition.
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  static throwOnStart = 0;
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: ((e: Event) => void) | null = null;
  onaudiostart: ((e: Event) => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: ((e: Event) => void) | null = null;
  stopCalls = 0;
  abortCalls = 0;
  private results: { transcript: string; isFinal: boolean }[] = [];

  start(): void {
    if (FakeRecognition.throwOnStart > 0) {
      FakeRecognition.throwOnStart--;
      throw new Error("InvalidStateError");
    }
    FakeRecognition.instances.push(this);
  }
  stop(): void {
    this.stopCalls++;
  }
  abort(): void {
    this.abortCalls++;
  }

  // test helpers
  begin(): void {
    this.onstart?.(new Event("start"));
    this.onaudiostart?.(new Event("audiostart"));
  }
  /** Replace result `index` (appending if new) and fire a result event. */
  say(index: number, transcript: string, isFinal: boolean): void {
    this.results[index] = { transcript, isFinal };
    const list = this.results.map((r) => Object.assign([{ transcript: r.transcript, confidence: 0.9 }], { isFinal: r.isFinal }));
    this.onresult?.({ resultIndex: index, results: list });
  }
  error(code: string): void {
    this.onerror?.({ error: code, message: "" });
  }
  end(): void {
    this.onend?.(new Event("end"));
  }
}

const latest = () => FakeRecognition.instances[FakeRecognition.instances.length - 1]!;

function setup() {
  const buffer = new TranscriptBuffer();
  const failures: string[] = [];
  const ends: string[] = [];
  const cb: RecognizerCallbacks = {
    onResult: (finals) => finals.forEach((f) => buffer.add(f)),
    onSessionStart: () => undefined,
    onSessionEnd: (_s, _d, reason) => ends.push(reason),
    onError: () => undefined,
    onFailure: (f) => failures.push(f),
    onStateChange: () => undefined,
  };
  const rec = new Recognizer("en-US", cb);
  return { rec, buffer, failures, ends };
}

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeRecognition.throwOnStart = 0;
  vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Recognizer", () => {
  it("configures continuous en-US recognition with interim results", () => {
    const { rec } = setup();
    rec.start();
    const r = latest();
    expect([r.lang, r.continuous, r.interimResults]).toEqual(["en-US", true, true]);
  });

  it("restarts when the browser ends the session and loses no text", () => {
    const { rec, buffer, ends } = setup();
    rec.setTurn(1);
    rec.start();
    const s1 = latest();
    s1.begin();
    s1.say(0, "I have been a nurse", true);
    s1.say(1, "for about six", false);
    s1.end(); // Chrome cut the session mid-sentence
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(ends).toEqual(["ended"]);
    const s2 = latest();
    s2.begin();
    s2.say(0, "years now", true);
    expect(buffer.text(1)).toBe("I have been a nurse for about six years now");
  });

  it("forced restart uses stop() and opens a new session on end", () => {
    const { rec, buffer, ends } = setup();
    rec.setTurn(1);
    rec.start();
    const s1 = latest();
    s1.begin();
    s1.say(0, "the hospital is", false);
    expect(rec.restart("forced")).toBe(true);
    expect(s1.stopCalls).toBe(1);
    s1.say(0, "the hospital is big", true); // stop() finalizes pending speech
    s1.end();
    expect(ends).toEqual(["forced"]);
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(buffer.text(1)).toBe("the hospital is big");
  });

  it("moves on if `end` never arrives after stop()", () => {
    vi.useFakeTimers();
    const { rec, buffer } = setup();
    rec.setTurn(1);
    rec.start();
    const s1 = latest();
    s1.begin();
    s1.say(0, "stuck words", false);
    rec.restart("stall");
    vi.advanceTimersByTime(1_600);
    expect(s1.abortCalls).toBe(1);
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(buffer.text(1)).toBe("stuck words");
    s1.end(); // late end from the old session is ignored
    expect(FakeRecognition.instances).toHaveLength(2);
  });

  it("does not restart after stop()", () => {
    const { rec, ends } = setup();
    rec.start();
    latest().begin();
    rec.stop();
    latest().end();
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(ends).toEqual(["stopped"]);
    expect(rec.state).toBe("stopped");
  });

  it("fails over after three network errors within 60 s", () => {
    vi.useFakeTimers();
    const { rec, failures } = setup();
    rec.start();
    for (let i = 0; i < 3; i++) {
      const s = latest();
      s.begin();
      s.error("network");
      if (i < 2) {
        s.end();
        vi.advanceTimersByTime(300); // quick-dying sessions restart with a short backoff
      }
    }
    expect(FakeRecognition.instances).toHaveLength(3);
    expect(failures).toEqual(["network"]);
    expect(rec.state).toBe("failed");
  });

  it("fails immediately on not-allowed", () => {
    const { rec, failures } = setup();
    rec.start();
    latest().error("not-allowed");
    expect(failures).toEqual(["not-allowed"]);
  });

  it("keeps pending text when it fails", () => {
    const { rec, buffer } = setup();
    rec.setTurn(4);
    rec.start();
    const s = latest();
    s.begin();
    s.say(0, "almost done", false);
    s.error("not-allowed");
    expect(buffer.text(4)).toBe("almost done");
  });

  it("retries when start() throws", () => {
    vi.useFakeTimers();
    FakeRecognition.throwOnStart = 1;
    const { rec } = setup();
    rec.start();
    expect(FakeRecognition.instances).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(FakeRecognition.instances).toHaveLength(1);
  });

  it("push-to-talk opens a session only while held", () => {
    const { rec } = setup();
    rec.setMode("push-to-talk");
    rec.start();
    expect(FakeRecognition.instances).toHaveLength(0);
    rec.pttDown();
    const s = latest();
    s.begin();
    rec.pttUp();
    expect(s.stopCalls).toBe(1);
    s.end();
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(rec.state).toBe("idle");
  });

  it("reports unsupported when there is no recognition API", () => {
    vi.stubGlobal("window", {});
    const { rec, failures } = setup();
    rec.start();
    expect(failures).toEqual(["unsupported"]);
  });
});
