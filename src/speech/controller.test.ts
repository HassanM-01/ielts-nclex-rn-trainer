// SpeechController turn handling, with a scripted recognizer and no audio
// (speechSynthesis is absent, so examiner lines end at once).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpeechController } from "./controller";

class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onstart: ((e: Event) => void) | null = null;
  onaudiostart: ((e: Event) => void) | null = null;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: ((e: Event) => void) | null = null;
  private results: { t: string; isFinal: boolean }[] = [];
  start(): void {
    FakeRecognition.last = this;
  }
  error(code: string): void {
    this.onerror?.({ error: code, message: "" });
  }
  stop(): void {}
  abort(): void {}
  begin(): void {
    this.onstart?.(new Event("start"));
  }
  /** Update the open result (or open a new one) and fire a result event. */
  hear(t: string, isFinal = false): void {
    const open = this.results[this.results.length - 1];
    if (open && !open.isFinal) {
      open.t = t;
      open.isFinal = isFinal;
    } else this.results.push({ t, isFinal });
    const list = this.results.map((r) => Object.assign([{ transcript: r.t, confidence: 1 }], { isFinal: r.isFinal }));
    this.onresult?.({ resultIndex: 0, results: list });
  }
}

const QUESTION = "Do you work or are you a student?";

async function setup(headphones: boolean) {
  const speech = new SpeechController();
  speech.setHeadphones(headphones);
  speech.startRecognizer();
  const rec = FakeRecognition.last!;
  rec.begin();
  return { speech, rec };
}

let win: EventTarget & { webkitSpeechRecognition: typeof FakeRecognition };

beforeEach(() => {
  win = Object.assign(new EventTarget(), { webkitSpeechRecognition: FakeRecognition });
  vi.stubGlobal("window", win);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SpeechController turns", () => {
  it("headphones: a quick answer merged with headphone leak reaches Julio's turn, echo trimmed", async () => {
    const { speech, rec } = await setup(true);
    const saying = speech.say(QUESTION);
    rec.hear("are you a student"); // the mic picks up the examiner through the headphones
    await saying;
    const answerTurn = speech.currentTurn;
    expect(answerTurn.kind).toBe("candidate");
    rec.hear("are you a student sorry", true); // same result, now with Julio's "Sorry?"
    expect(speech.turnText(answerTurn.id)).toBe("sorry");
    speech.stop();
  });

  it("speakers: text that began during the examiner's line stays out of the answer", async () => {
    const { speech, rec } = await setup(false);
    const saying = speech.say(QUESTION);
    rec.hear("are you a student");
    await saying;
    const answerTurn = speech.currentTurn;
    rec.hear("are you a student", true);
    rec.hear("I work as a nurse", true);
    expect(speech.turnText(answerTurn.id)).toBe("I work as a nurse");
    speech.stop();
  });

  it("a finished examiner-audio result is not carried into the answer", async () => {
    const { speech, rec } = await setup(true);
    const saying = speech.say(QUESTION);
    rec.hear("or are you a student", true);
    await saying;
    const answerTurn = speech.currentTurn;
    rec.hear("I am a nurse", true);
    expect(speech.turnText(answerTurn.id)).toBe("I am a nurse");
    speech.stop();
  });
});

describe("SpeechController silence and recovery", () => {
  it("counts silence from the last change in his words, not from repeated events", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { speech, rec } = await setup(false);
    await speech.say(QUESTION);
    now = 1_000;
    rec.hear("I work as a nurse");
    now = 4_000;
    rec.hear("I work as a nurse"); // same words again: not speaking
    rec.hear("I work as a nurse.", true); // finalized with punctuation: still the same words
    now = 6_000;
    expect(speech.silenceMs(now)).toBe(5_000);
    rec.hear("and I like it");
    expect(speech.silenceMs(now)).toBe(0);
    speech.stop();
  });

  it("goes back to continuous recognition when the network returns", async () => {
    const { speech, rec } = await setup(true);
    for (let i = 0; i < 3; i++) rec.error("network");
    expect(speech.recognizer.mode).toBe("push-to-talk");
    expect(speech.canHear).toBe(false);
    expect(speech.failure).toBe("network");
    win.dispatchEvent(new Event("online"));
    expect(speech.recognizer.mode).toBe("continuous");
    expect(speech.failure).toBeNull();
    expect(speech.metrics.getCounters().rec_retries).toBe(1);
    speech.stop();
  });

  it("doesn't retry after a permission failure", async () => {
    const { speech, rec } = await setup(true);
    rec.error("not-allowed");
    win.dispatchEvent(new Event("online"));
    expect(speech.recognizer.mode).toBe("push-to-talk");
    expect(speech.failure).toBe("not-allowed");
    speech.stop();
  });
});
