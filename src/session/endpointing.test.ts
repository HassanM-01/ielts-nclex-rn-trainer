import { describe, expect, it } from "vitest";
import { IELTS_ENDPOINTING, PART1_RULES, PART3_RULES } from "../exams/ielts";
import type { MonologueRules } from "../exams/types";
import {
  commitSilenceMs,
  decideAnswer,
  decideMonologue,
  endsWithContinuationCue,
  pauseP90,
  personalBaseMs,
  pickUnusedBullet,
  type AnswerTick,
  type MonologueTick,
} from "./endpointing";

const D = IELTS_ENDPOINTING;
const LONG = "I work as a nurse in a big public hospital in the city";

describe("continuation cues", () => {
  it.each(["and", "but", "because", "so", "or", "then", "like", "the", "a", "my", "um", "uh", "eh"])("'... %s' continues", (w) => {
    expect(endsWithContinuationCue(`I went there ${w}`)).toBe(true);
  });
  it("recognizes the two-word cues", () => {
    expect(endsWithContinuationCue("There are many reasons, for example")).toBe(true);
    expect(endsWithContinuationCue("It depends. I think")).toBe(true);
  });
  it("ignores punctuation and a finished sentence", () => {
    expect(endsWithContinuationCue("It is important because...")).toBe(true);
    expect(endsWithContinuationCue("I like it a lot.")).toBe(false);
    expect(endsWithContinuationCue("")).toBe(false);
  });
});

describe("commitSilenceMs", () => {
  it("uses the base for a complete, long answer", () => {
    expect(commitSilenceMs(LONG, 2_500, 0, D)).toBe(2_500);
    expect(commitSilenceMs(LONG, 3_500, 0, D)).toBe(3_500);
  });
  it("adds 1.5 s after a continuation cue or under 6 words", () => {
    expect(commitSilenceMs(`${LONG} because`, 2_500, 0, D)).toBe(4_000);
    expect(commitSilenceMs("Yes I do", 2_500, 0, D)).toBe(4_000);
  });
  it("adds the level's extra patience", () => {
    expect(commitSilenceMs(LONG, 2_500, 1_000, D)).toBe(3_500);
  });
  it("doesn't extend a repeat request (it isn't an answer)", () => {
    expect(commitSilenceMs("Sorry?", 2_500, 0, D)).toBe(2_500);
  });
});

describe("personal calibration", () => {
  it("is max(default, p90 + 0.4 s), capped at default + 1.5 s", () => {
    expect(personalBaseMs(2_500, null)).toBe(2_500);
    expect(personalBaseMs(2_500, 1_500)).toBe(2_500);
    expect(personalBaseMs(2_500, 2_600)).toBe(3_000);
    expect(personalBaseMs(2_500, 9_000)).toBe(4_000);
  });
  it("computes the 90th percentile of pauses", () => {
    expect(pauseP90([100, 200, 300])).toBeNull();
    expect(pauseP90([100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000])).toBe(900);
  });
});

describe("decideAnswer", () => {
  const tick = (over: Partial<AnswerTick>): AnswerTick => ({
    now: 20_000,
    text: LONG,
    silenceMs: 0,
    voicedRecently: false,
    rules: PART1_RULES,
    extraPatienceMs: 0,
    defaults: D,
    ...over,
  });
  const turn = { listenStartedAt: 10_000, speechStartedAt: 11_000, repeated: false };

  it("commits after the silence", () => {
    expect(decideAnswer(turn, tick({ silenceMs: 2_499 })).type).toBe("wait");
    expect(decideAnswer(turn, tick({ silenceMs: 2_500 })).type).toBe("commit");
  });

  it("does not commit a pause right after 'because' in Part 3 (4 s)", () => {
    const t = tick({ text: `${LONG} because`, rules: PART3_RULES, silenceMs: 4_000 });
    expect(decideAnswer(turn, t).type).toBe("wait");
    expect(decideAnswer(turn, { ...t, silenceMs: 5_000 }).type).toBe("commit");
  });

  it("gives 'because' in Part 1 4 s", () => {
    const t = tick({ text: `${LONG} because` });
    expect(decideAnswer(turn, { ...t, silenceMs: 3_900 }).type).toBe("wait");
    expect(decideAnswer(turn, { ...t, silenceMs: 4_000 }).type).toBe("commit");
  });

  it("can't count silence from before this listening turn", () => {
    expect(decideAnswer({ ...turn, listenStartedAt: 19_000 }, tick({ silenceMs: 9_000 })).type).toBe("wait");
  });

  it("treats a whole-utterance repeat request as a request", () => {
    expect(decideAnswer(turn, tick({ text: "Sorry?", silenceMs: 2_500 })).type).toBe("repeat-request");
    expect(decideAnswer(turn, tick({ text: "Sorry, I don't really like shoes", silenceMs: 2_500 })).type).toBe("commit");
  });

  it("cuts in after about 40 s of answer", () => {
    expect(decideAnswer(turn, tick({ now: 50_999 })).type).toBe("wait");
    expect(decideAnswer(turn, tick({ now: 51_000 })).type).toBe("time-limit");
    expect(decideAnswer(turn, tick({ now: 90_000, rules: PART3_RULES })).type).toBe("wait");
  });

  it("repeats once after 8 s of no speech, then moves on", () => {
    const silent = tick({ text: "", silenceMs: 99_000 });
    expect(decideAnswer({ ...turn, speechStartedAt: null }, { ...silent, now: 17_999 }).type).toBe("wait");
    expect(decideAnswer({ ...turn, speechStartedAt: null }, { ...silent, now: 18_000 }).type).toBe("no-speech-repeat");
    expect(decideAnswer({ ...turn, speechStartedAt: null, repeated: true }, { ...silent, now: 18_000 }).type).toBe("move-on");
  });

  it("waits while the VAD hears voice that has no text yet, but not forever", () => {
    const quiet = { ...turn, speechStartedAt: null };
    expect(decideAnswer(quiet, tick({ text: "", now: 20_000, voicedRecently: true })).type).toBe("wait");
    // Room noise the VAD calls voice can't hold the exam past 16 s.
    expect(decideAnswer(quiet, tick({ text: "", now: 26_000, voicedRecently: true })).type).toBe("no-speech-repeat");
  });
});

describe("decideMonologue", () => {
  const rules: MonologueRules = { hardStopMs: 120_000, goalMs: 120_000, backupSilenceMs: 4_000, endSilenceMs: 6_000 };
  const m = { startedAt: 0, listenStartedAt: 0, speechStartedAt: 1_000, backupUsed: false, startRepeated: false };
  const tick = (over: Partial<MonologueTick>): MonologueTick => ({
    now: 30_000,
    text: LONG,
    silenceMs: 0,
    voicedRecently: false,
    rules,
    noSpeechMs: 8_000,
    ...over,
  });

  it("stops hard at 2:00", () => {
    expect(decideMonologue(m, tick({ now: 119_999 })).type).toBe("wait");
    expect(decideMonologue(m, tick({ now: 120_000 })).type).toBe("hard-stop");
  });
  it("gives one back-up prompt after 4 s of silence before the goal", () => {
    expect(decideMonologue(m, tick({ silenceMs: 3_999 })).type).toBe("wait");
    expect(decideMonologue(m, tick({ silenceMs: 4_000 })).type).toBe("backup-prompt");
  });
  it("ends after 6 s of silence once the prompt was used or the goal passed", () => {
    const used = { ...m, backupUsed: true, listenStartedAt: 20_000 };
    expect(decideMonologue(used, tick({ silenceMs: 5_999 })).type).toBe("wait");
    expect(decideMonologue(used, tick({ silenceMs: 6_000 })).type).toBe("commit");
    const lowerLevel = { ...rules, goalMs: 60_000 };
    expect(decideMonologue(m, tick({ now: 70_000, silenceMs: 4_500, rules: lowerLevel })).type).toBe("wait");
    expect(decideMonologue(m, tick({ now: 70_000, silenceMs: 6_000, rules: lowerLevel })).type).toBe("commit");
  });
  it("repeats 'Please start speaking now' after 8 s of nothing, then moves on", () => {
    const silent = { ...m, speechStartedAt: null };
    expect(decideMonologue(silent, tick({ text: "", now: 8_000 })).type).toBe("repeat-start");
    expect(decideMonologue({ ...silent, startRepeated: true }, tick({ text: "", now: 8_000 })).type).toBe("move-on");
  });
});

describe("pickUnusedBullet", () => {
  const bullets = ["where it was", "when you went there", "what made it noisy"];
  it("picks the bullet he said least about", () => {
    expect(pickUnusedBullet(bullets, "It was a market in Guadalajara. I went there last summer with my family.")).toBe("what made it noisy");
    expect(pickUnusedBullet(bullets, "It was so noisy because of the music and the traffic")).toBe("when you went there");
  });
  it("picks an uncovered bullet when nothing was said", () => {
    expect(pickUnusedBullet(bullets, "")).toBe("when you went there");
    expect(pickUnusedBullet([], "")).toBeNull();
  });
  it("prefers an unchecked bullet over a covered one", () => {
    expect(pickUnusedBullet(bullets, "I went there last year and it was noisy")).toBe("where it was");
  });
});
