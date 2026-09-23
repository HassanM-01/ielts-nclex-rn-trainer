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

beforeEach(() => {
  vi.stubGlobal("window", { webkitSpeechRecognition: FakeRecognition });
});
afterEach(() => {
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
