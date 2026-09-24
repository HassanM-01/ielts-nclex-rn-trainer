import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXED_SET } from "../exams/ielts-fixed-set";
import { buildIeltsScript, IELTS_ENDPOINTING, LINES } from "../exams/ielts";
import { Metrics } from "../metrics/latency";
import type { SayOptions, SayResult, Turn, TurnKind } from "../speech/controller";
import type { ExamCheckpoint } from "./checkpoint";
import { ExamEngine, type SpeechPort } from "./engine";
import type { ExaminerOutcome, ExaminerPort } from "./examiner-client";
import type { ExaminerTurnRequest } from "../shared/examiner-api";

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
  canHear = true;
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
  silenceDiag(): string {
    return "diag";
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

/** Scripted examiner model: replies are queued; "hang" never answers until aborted. */
class FakeExaminer implements ExaminerPort {
  calls = 0;
  pings = 0;
  requests: { body: ExaminerTurnRequest; signal?: AbortSignal }[] = [];
  replies: (ExaminerOutcome | "hang")[] = [];
  request(body: ExaminerTurnRequest, signal?: AbortSignal): Promise<ExaminerOutcome> {
    this.calls++;
    this.requests.push({ body, signal });
    const r = this.replies.shift() ?? { ok: true, reply: { type: "next" }, ms: 300, raw: "[NEXT]" };
    if (r === "hang") {
      return new Promise((resolve) => signal?.addEventListener("abort", () => resolve({ ok: false, reason: "aborted", ms: 0 })));
    }
    return Promise.resolve(r);
  }
  ping(): void {
    this.pings++;
  }
}

const followup = (text: string): ExaminerOutcome => ({ ok: true, reply: { type: "followup", text }, ms: 400, raw: text });

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

function setup(cpOver: Partial<ExamCheckpoint> = {}, examiner: ExaminerPort | null = null) {
  const speech = new FakeSpeech();
  const cp = checkpoint(cpOver);
  const steps = buildIeltsScript(cp.items, { examinerName: "Sonia", level: 3, hour: 15 });
  const saves: number[] = [];
  const engine = new ExamEngine(speech, steps, cp, {
    level: 3,
    defaults: IELTS_ENDPOINTING,
    save: (c) => saves.push(c.nextStep),
    wallClock: () => 1_000_000 + clock,
    examiner,
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
    // Part 3 (no examiner model here: fully scripted), then the closing line.
    expect(engine.state).toBe("part3");
    expect(speech.lastSaid).toBe(`${LINES.part3Link("a noisy place you have been to")} ${FIXED_SET.part3!.questions[0]!.q}`);
    for (let i = 0; i < 6; i++) await answer(speech, "People in big cities hear traffic and construction all day long");
    expect(engine.phase.kind).toBe("done");
    expect(speech.lastSaid).toBe(LINES.closing);
    expect(cp.finished).toBe(true);
    expect(speech.stopped).toBe(true);

    const part2 = cp.answers.find((a) => a.stepId === "p2-noisy-place");
    expect(part2?.text).toBe("It was a market in Guadalajara and I went there last summer There was loud music and many people shouting");
    expect(part2?.backupPrompt).toBe(true);
    expect(cp.answers.filter((a) => a.outcome === "answered")).toHaveLength(22);
    expect(cp.answers.filter((a) => a.part === 3)).toHaveLength(6);
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

  it("doesn't skip questions while the app can't hear (push-to-talk after a failure)", async () => {
    const { speech, engine, cp } = setup({ nextStep: 2 });
    speech.canHear = false;
    engine.start();
    await flush();
    const asked = speech.said.length;
    clock += 30_000;
    speech.tick(clock);
    await flush();
    expect(speech.said.length).toBe(asked);
    // He holds the button and answers: it commits as usual.
    await answer(speech, LONG);
    expect(cp.answers.find((a) => a.stepId === "p1-work-q1")?.outcome).toBe("answered");
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

describe("ExamEngine Part 3", () => {
  const P3 = FIXED_SET.part3!.questions;
  const PART3_STEP = 18;

  it("warms the examiner function at the start of Part 2 prep", async () => {
    const ex = new FakeExaminer();
    const { engine } = setup({ nextStep: 14 }, ex);
    engine.start();
    await flush();
    expect(engine.phase.kind).toBe("prep");
    expect(ex.pings).toBe(1);
    expect(ex.calls).toBe(0);
  });

  it("opens with the link sentence and asks a model follow-up, then the next listed question", async () => {
    const ex = new FakeExaminer();
    ex.replies.push(followup("You mentioned the market. Why is it so noisy?"));
    const { speech, engine, cp } = setup({ nextStep: PART3_STEP }, ex);
    engine.start();
    await flush();
    expect(engine.state).toBe("part3");
    expect(speech.lastSaid).toContain(LINES.part3Link("a noisy place you have been to"));
    expect(speech.lastSaid).toContain(P3[0]!.q);

    await answer(speech, LONG);
    const last = speech.said[speech.said.length - 1]!;
    expect(last.text).toBe("You mentioned the market. Why is it so noisy?");
    expect(last.opts.source).toBe("ai");
    expect(last.opts.commitAt).toBe(clock);
    expect(ex.calls).toBe(1); // the speculative request was reused
    expect(ex.requests[0]?.body.exchange.at(-1)).toEqual({ role: "candidate", text: LONG });
    expect(ex.requests[0]?.body.questions).toEqual(P3.map((q) => q.q));

    // After a follow-up answer: no model call, the scripted next question.
    await answer(speech, LONG);
    expect(speech.lastSaid).toBe(P3[1]!.q);
    expect(ex.calls).toBe(1);
    expect(cp.answers.filter((a) => a.part === 3).map((a) => a.stepId)).toEqual(["p3-noise-q1", "p3-noise-q1-f", "p3-noise-q2"]);
    expect(cp.answers.find((a) => a.stepId === "p3-noise-q1-f")?.question).toBe("You mentioned the market. Why is it so noisy?");
  });

  it("asks the next listed question on [NEXT]", async () => {
    const ex = new FakeExaminer();
    const { speech, engine } = setup({ nextStep: PART3_STEP }, ex);
    engine.start();
    await flush();
    await answer(speech, LONG);
    const last = speech.said[speech.said.length - 1]!;
    expect(last.text).toBe(P3[1]!.q);
    expect(last.opts.source).toBe("ai");
  });

  it("falls back to the scripted next question after the 1.2 s deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ex = new FakeExaminer();
    ex.replies.push("hang");
    const { speech, engine } = setup({ nextStep: PART3_STEP }, ex);
    engine.start();
    await flush();
    await answer(speech, LONG);
    expect(speech.lastSaid).not.toBe(P3[1]!.q);
    await vi.advanceTimersByTimeAsync(1_200);
    await flush();
    expect(speech.lastSaid).toBe(P3[1]!.q);
    expect(ex.requests[0]?.signal?.aborted).toBe(true);
    expect(speech.metrics.getCounters()["examiner_fallback:timeout"]).toBe(1);
    vi.useRealTimers();
  });

  it("cancels the speculative request when he keeps talking", async () => {
    const ex = new FakeExaminer();
    ex.replies.push("hang");
    const { speech, engine } = setup({ nextStep: PART3_STEP }, ex);
    engine.start();
    await flush();
    speech.reply("I think the market is");
    clock += 1_500;
    speech.silence = 1_200;
    speech.tick(clock); // 1.2 s pause: the speculative request goes out
    expect(ex.calls).toBe(1);
    speech.silence = 0;
    clock += 100;
    speech.tick(clock); // talking again
    expect(ex.requests[0]?.signal?.aborted).toBe(true);
    expect(speech.metrics.getCounters().spec_aborted).toBe(1);
  });

  it("asks again when the answer grew more than 3 words after the speculative request", async () => {
    const ex = new FakeExaminer();
    ex.replies.push("hang", followup("Why do you think that is?"));
    const { speech, engine } = setup({ nextStep: PART3_STEP }, ex);
    engine.start();
    await flush();
    speech.reply("the market and");
    clock += 1_500;
    speech.silence = 1_200;
    speech.tick(clock);
    expect(ex.calls).toBe(1);
    await answer(speech, "the market and the bus station and the big hospital downtown");
    expect(ex.calls).toBe(2);
    expect(ex.requests[0]?.signal?.aborted).toBe(true);
    expect(speech.lastSaid).toBe("Why do you think that is?");
  });

  it("repeats a listed question with the bank's rephrase", async () => {
    const { speech, engine } = setup({ nextStep: PART3_STEP }, new FakeExaminer());
    engine.start();
    await flush();
    await answer(speech, "Sorry?", 3_500); // Part 3 waits 3.5 s
    expect(speech.lastSaid).toBe(P3[0]!.rephrase);
  });

  it("does not end a Part 3 turn 4 s after 'because'", async () => {
    const { speech, engine } = setup({ nextStep: PART3_STEP }, null);
    engine.start();
    await flush();
    const asked = speech.said.length;
    await answer(speech, `${LONG} because`, 4_000);
    expect(speech.said.length).toBe(asked);
    await answer(speech, `${LONG} because`, 5_000);
    expect(speech.said.length).toBe(asked + 1);
  });

  it("ends after the first answer past 4:30 once 4 listed questions were asked", async () => {
    const { speech, engine, cp } = setup({ nextStep: PART3_STEP }, null);
    engine.start();
    await flush();
    for (let i = 0; i < 3; i++) {
      clock += 70_000;
      await answer(speech, LONG);
    }
    expect(engine.state).toBe("part3");
    clock += 70_000; // now past 4:30, with 4 asked
    await answer(speech, LONG);
    expect(speech.lastSaid).toBe(LINES.closing);
    expect(cp.answers.filter((a) => a.part === 3)).toHaveLength(4);
    expect(engine.phase.kind).toBe("done");
  });

  it("is fully scripted without an examiner", async () => {
    const { speech, engine } = setup({ nextStep: PART3_STEP }, null);
    engine.start();
    await flush();
    await answer(speech, LONG);
    const last = speech.said[speech.said.length - 1]!;
    expect(last.text).toBe(P3[1]!.q);
    expect(last.opts.source).toBe("scripted");
  });

  it("resumes Part 3 at the next listed question", async () => {
    const { speech, engine } = setup({ nextStep: PART3_STEP, part3Next: 2 }, null);
    engine.start();
    await flush();
    expect(speech.lastSaid).toBe(`Let's continue. ${P3[2]!.q}`);
  });
});
