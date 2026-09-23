import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXED_SET } from "../exams/ielts-fixed-set";
import { buildIeltsScript, IELTS_ENDPOINTING, LINES } from "../exams/ielts";
import { Metrics } from "../metrics/latency";
import type { SayOptions, SayResult, Turn, TurnKind } from "../speech/controller";
import type { ExamCheckpoint } from "./checkpoint";
import { ExamEngine, type SpeechPort } from "./engine";

// Scriptable stand-in for the speech controller: say() resolves on the next
// microtask; the test sets what Julio "said", the silence, and the clock.
class FakeSpeech implements SpeechPort {
  started = false;
  pauses: { turnId: number; ms: number }[] = [];
  metrics = new Metrics();
  said: { text: string; opts: SayOptions }[] = [];
  turns: Turn[] = [];
  texts = new Map<number, string>();
  silence = 0;
  voiced = false;
  monologue = false;
  rate = 1;
  stopped = false;
  bargeInNext = false;
  private seq = 0;
  private ticks = new Set<(now: number) => void>();

  constructor() {
    this.newTurn("discard");
  }

  get currentTurn(): Turn {
    return this.turns[this.turns.length - 1]!;
  }
  async start(): Promise<void> {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  say(text: string, opts: SayOptions = {}): Promise<SayResult> {
    this.said.push({ text, opts });
    const turn = this.newTurn("examiner", text);
    const bargedIn = this.bargeInNext && opts.interruptible !== false;
    this.bargeInNext = false;
    return Promise.resolve().then(() => {
      if (this.currentTurn === turn) this.newTurn(bargedIn ? "candidate" : (opts.then ?? "candidate"), text);
      return { cancelled: bargedIn, fellBack: false, watchdogs: 0, skipped: 0, bargedIn };
    });
  }
  cancelSpeech(): void {}
  newTurn(kind: TurnKind, line = ""): Turn {
    const t = { id: ++this.seq, kind, startedAt: 0, line };
    this.turns.push(t);
    return t;
  }
  turnText(id: number): string {
    return this.texts.get(id) ?? "";
  }
  silenceMs(): number {
    return this.silence;
  }
  voicedRecently(): boolean {
    return this.voiced;
  }
  setMonologue(on: boolean): void {
    this.monologue = on;
  }
  setRate(rate: number): void {
    this.rate = rate;
  }
  onTick(fn: (now: number) => void): () => void {
    this.ticks.add(fn);
    return () => this.ticks.delete(fn);
  }

  // helpers
  reply(text: string): void {
    this.texts.set(this.currentTurn.id, text);
  }
  tick(now: number): void {
    for (const fn of this.ticks) fn(now);
  }
  get lastSaid(): string {
    return this.said[this.said.length - 1]?.text ?? "";
  }
}

let clock = 0;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function checkpoint(over: Partial<ExamCheckpoint> = {}): ExamCheckpoint {
  return {
    v: 1,
    id: "t",
    exam: "ielts",
    mode: "full",
    level: 3,
    startedAt: "2026-09-23T15:00:00.000Z",
    updatedAt: "2026-09-23T15:00:00.000Z",
    items: FIXED_SET,
    examinerName: "Sonia",
    voiceURI: null,
    nextStep: 0,
    answers: [],
    notes: "",
    finished: false,
    endedEarly: false,
    ...over,
  };
}

function setup(cpOver: Partial<ExamCheckpoint> = {}) {
  const speech = new FakeSpeech();
  const cp = checkpoint(cpOver);
  const steps = buildIeltsScript(cp.items, { examinerName: "Sonia", level: 3, hour: 15 });
  const saves: number[] = [];
  const engine = new ExamEngine(speech, steps, cp, {
    level: 3,
    defaults: IELTS_ENDPOINTING,
    save: (c) => saves.push(c.nextStep),
    wallClock: () => 1_000_000 + clock,
  });
  return { speech, engine, cp, saves };
}

/** Julio answers the current question, then goes quiet long enough to commit. */
async function answer(speech: FakeSpeech, text: string, silence = 4_000) {
  speech.reply(text);
  clock += Math.max(5_000, silence + 500); // the silence must fit after the line ended
  speech.silence = silence;
  speech.tick(clock);
  speech.silence = 0;
  await flush();
}

const LONG = "I work as a nurse in a big public hospital in the city";

beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});
afterEach(() => vi.restoreAllMocks());

describe("ExamEngine", () => {
  it("runs the opening, Part 1 and Part 2 end to end", async () => {
    const { speech, engine, cp, saves } = setup();
    engine.start(0);
    await flush();
    expect(speech.rate).toBe(1.0);
    expect(speech.lastSaid).toBe("Good afternoon. My name is Sonia. Can you tell me your full name, please?");
    expect(speech.said[0]?.opts.clickAt).toBe(0);
    expect(engine.state).toBe("opening");

    await answer(speech, "My name is Julio Garcia Lopez");
    expect(speech.lastSaid).toBe(LINES.id);
    await answer(speech, "Yes here it is");
    expect(engine.state).toBe("part1");
    for (let i = 0; i < 12; i++) await answer(speech, LONG);

    // Part 2: instructions, then 1 minute of prep with the card.
    expect(engine.state).toBe("part2_prep");
    expect(engine.phase.kind).toBe("prep");
    expect(engine.card?.id).toBe("p2-noisy-place");
    clock += 60_000;
    speech.tick(clock);
    await flush();
    expect(speech.lastSaid).toBe(LINES.part2Start);
    expect(engine.state).toBe("part2_speak");
    expect(speech.monologue).toBe(true);

    // He talks, pauses 4 s: one back-up prompt about an unused bullet.
    await answer(speech, "It was a market in Guadalajara and I went there last summer", 4_000);
    expect(speech.lastSaid).toBe("Can you tell me any more about what made it noisy?");
    // More talk, then 6 s of silence ends the long turn.
    await answer(speech, "There was loud music and many people shouting", 6_000);
    expect(speech.monologue).toBe(false);
    expect(engine.state).toBe("part2_roundoff");
    expect(speech.lastSaid).toBe(`Thank you. ${FIXED_SET.part2.roundoff[0]}`);

    await answer(speech, "I prefer quiet places because I work nights");
    expect(engine.phase.kind).toBe("done");
    expect(speech.lastSaid).toBe(LINES.closing);
    expect(cp.finished).toBe(true);
    expect(speech.stopped).toBe(true);

    const part2 = cp.answers.find((a) => a.stepId === "p2-noisy-place");
    expect(part2?.text).toBe("It was a market in Guadalajara and I went there last summer There was loud music and many people shouting");
    expect(part2?.backupPrompt).toBe(true);
    expect(cp.answers.filter((a) => a.outcome === "answered")).toHaveLength(16);
    expect(saves.length).toBeGreaterThanOrEqual(16);
  });

  it("repeats the question verbatim on 'Sorry?' and keeps the request out of the answer", async () => {
    const { speech, engine, cp } = setup({ nextStep: 2 });
    engine.start();
    await flush();
    await answer(speech, "Sorry?", 2_500);
    expect(speech.lastSaid).toBe("Do you work or are you a student?");
    await answer(speech, LONG);
    const rec = cp.answers.find((a) => a.stepId === "p1-work-q1");
    expect(rec?.text).toBe(LONG);
    expect(rec?.repeatRequests).toBe(1);
    expect(rec?.repeats).toBe(1);
  });

  it("repeats only once: a second request moves on", async () => {
    const { speech, engine, cp } = setup({ nextStep: 2 });
    engine.start();
    await flush();
    await answer(speech, "Pardon?", 2_500);
    await answer(speech, "Sorry?", 2_500);
    expect(cp.answers.find((a) => a.stepId === "p1-work-q1")?.outcome).toBe("no-answer");
    expect(speech.lastSaid).toBe("What do you like most about your job?");
  });

  it("commits 'Sorry, I don't really like shoes' as an answer", async () => {
    const { speech, engine, cp } = setup({ nextStep: 6 });
    engine.start();
    await flush();
    expect(speech.lastSaid).toContain("Do you like buying shoes?");
    await answer(speech, "Sorry, I don't really like shoes", 4_000);
    expect(cp.answers.find((a) => a.stepId === "p1-shoes-q1")?.text).toBe("Sorry, I don't really like shoes");
    expect(speech.lastSaid).toBe("How often do you buy new shoes?");
  });

  it("does not end a Part 1 turn 3.9 s after 'because'", async () => {
    const { speech, engine } = setup({ nextStep: 2 });
    engine.start();
    await flush();
    const asked = speech.said.length;
    await answer(speech, `${LONG} because`, 3_900);
    expect(speech.said.length).toBe(asked);
    expect(engine.phase.kind).toBe("listening");
  });

  it("with no speech, repeats after 8 s and moves on after 8 more", async () => {
    const { speech, engine, cp } = setup({ nextStep: 2 });
    engine.start();
    await flush();
    clock += 8_000;
    speech.tick(clock);
    await flush();
    expect(speech.lastSaid).toBe("Do you work or are you a student?");
    clock += 8_000;
    speech.tick(clock);
    await flush();
    expect(cp.answers.find((a) => a.stepId === "p1-work-q1")?.outcome).toBe("no-answer");
    expect(speech.lastSaid).toBe("What do you like most about your job?");
  });

  it("cuts in politely after 40 s and the interruption can't be talked over", async () => {
    const { speech, engine, cp } = setup({ nextStep: 2 });
    engine.start();
    await flush();
    speech.reply(LONG);
    clock += 1_000;
    speech.tick(clock); // speech starts
    clock += 40_000;
    speech.tick(clock);
    await flush();
    expect(cp.answers.find((a) => a.stepId === "p1-work-q1")?.outcome).toBe("time-limit");
    const last = speech.said[speech.said.length - 1];
    expect(last?.text).toBe("Thank you. What do you like most about your job?");
    expect(last?.opts.interruptible).toBe(false);
  });

  it("stops Part 2 at exactly 2:00 with 'Thank you.'", async () => {
    const { speech, engine, cp } = setup({ nextStep: 14 });
    engine.start();
    await flush();
    clock += 60_000;
    speech.tick(clock);
    await flush();
    speech.reply(LONG);
    clock += 119_000;
    speech.tick(clock);
    await flush();
    expect(engine.state).toBe("part2_speak");
    clock += 1_000;
    speech.tick(clock);
    await flush();
    expect(cp.answers.find((a) => a.stepId === "p2-noisy-place")?.outcome).toBe("hard-stop");
    expect(speech.lastSaid).toBe(`Thank you. ${FIXED_SET.part2.roundoff[0]}`);
    expect(speech.said[speech.said.length - 1]?.opts.interruptible).toBe(false);
  });

  it("commits at once on the spacebar", async () => {
    const { speech, engine, cp } = setup({ nextStep: 2 });
    engine.start();
    await flush();
    speech.reply("I am a nurse");
    engine.commitNow();
    await flush();
    expect(cp.answers.find((a) => a.stepId === "p1-work-q1")?.outcome).toBe("answered");
    expect(speech.lastSaid).toBe("What do you like most about your job?");
  });

  it("measures commit -> examiner audio on the next scripted line", async () => {
    const { speech, engine } = setup({ nextStep: 2 });
    engine.start();
    await flush();
    await answer(speech, LONG);
    const last = speech.said[speech.said.length - 1];
    expect(last?.opts.commitAt).toBe(clock);
    expect(last?.opts.source).toBe("scripted");
  });

  it("'Repetir pregunta' replays the last line verbatim", async () => {
    const { speech, engine } = setup({ nextStep: 3 });
    engine.start();
    await flush();
    const line = speech.lastSaid;
    engine.repeatLast();
    await flush();
    expect(speech.lastSaid).toBe(line);
    expect(engine.phase.kind).toBe("listening");
  });

  it("keeps what he said when he talks over the examiner", async () => {
    const { speech, engine, cp } = setup({ nextStep: 2 });
    speech.bargeInNext = true;
    engine.start();
    await flush();
    expect(engine.phase.kind).toBe("listening");
    await answer(speech, LONG);
    expect(cp.answers.find((a) => a.stepId === "p1-work-q1")?.text).toBe(LONG);
  });

  it("'Terminar' ends early and keeps the answers", async () => {
    const { speech, engine, cp } = setup({ nextStep: 2 });
    engine.start();
    await flush();
    await answer(speech, LONG);
    speech.reply("I like the");
    engine.end();
    expect(cp.finished).toBe(true);
    expect(cp.endedEarly).toBe(true);
    expect(cp.answers.map((a) => a.outcome)).toEqual(["answered", "ended"]);
    expect(engine.phase.kind).toBe("done");
  });

  it("resumes at the next step with 'Let's continue.'", async () => {
    const { speech, engine } = setup({ nextStep: 7 });
    engine.start();
    await flush();
    expect(speech.lastSaid).toBe("Let's continue. How often do you buy new shoes?");
  });
});
