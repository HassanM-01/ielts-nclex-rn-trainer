import { describe, expect, it } from "vitest";
import { SessionResults, TranscriptBuffer, type ResultSnapshot } from "./transcript";

const r = (transcript: string, isFinal: boolean, confidence = 0.9): ResultSnapshot => ({ transcript, isFinal, confidence });

describe("SessionResults", () => {
  it("emits each final once, even though the result list is cumulative", () => {
    const s = new SessionResults(1);
    expect(s.apply([r("hello", false)], 1, 0).finals).toEqual([]);
    expect(s.apply([r("hello there", true)], 1, 1).finals.map((f) => f.text)).toEqual(["hello there"]);
    const third = s.apply([r("hello there", true), r("how are", false)], 1, 2);
    expect(third.finals).toEqual([]);
    expect(third.interims.get(1)).toBe("how are");
  });

  it("keeps a result with the turn it started in", () => {
    const s = new SessionResults(1);
    s.apply([r("I work as a", false)], 5, 0);
    const { finals } = s.apply([r("I work as a nurse", true)], 6, 1); // turn switched meanwhile
    expect(finals[0]?.turnId).toBe(5);
  });

  it("promotes unfinished interim text when the session ends", () => {
    const s = new SessionResults(1);
    s.apply([r("first part", true), r("second part", false)], 1, 0);
    const promoted = s.flush(1);
    expect(promoted.map((p) => [p.text, p.promoted])).toEqual([["second part", true]]);
    expect(s.flush(2)).toEqual([]); // only once
  });

  it("retags pending results on barge-in", () => {
    const s = new SessionResults(1);
    s.apply([r("excuse me I", false)], 10, 0);
    s.retag(10, 11);
    expect(s.apply([r("excuse me I think", true)], 11, 1).finals[0]?.turnId).toBe(11);
  });

  it("ignores results after flush", () => {
    const s = new SessionResults(1);
    s.flush(0);
    expect(s.apply([r("late", true)], 1, 1).finals).toEqual([]);
  });
});

describe("TranscriptBuffer", () => {
  it("joins a turn's text across sessions (restarts lose nothing)", () => {
    const b = new TranscriptBuffer();
    const s1 = new SessionResults(1);
    const s2 = new SessionResults(2);
    s1.apply([r("my hometown is", true)], 3, 0).finals.forEach((f) => b.add(f));
    s1.apply([r("my hometown is", true), r("a small city", false)], 3, 1);
    s1.flush(2).forEach((f) => b.add(f)); // browser ended the session mid-sentence
    s2.apply([r("near the coast", true)], 3, 3).finals.forEach((f) => b.add(f));
    expect(b.text(3)).toBe("my hometown is a small city near the coast");
    expect(b.segments(3).map((s) => s.session)).toEqual([1, 1, 2]);
  });

  it("moves a turn and replaces text", () => {
    const b = new TranscriptBuffer();
    b.add({ turnId: 1, text: "a student I work", confidence: 0.9, at: 0, session: 1, promoted: false });
    b.move(1, 2);
    expect(b.text(1)).toBe("");
    b.replaceText(2, 0, "I work");
    expect(b.text(2)).toBe("I work");
  });

  it("skips segments emptied by echo trim", () => {
    const b = new TranscriptBuffer();
    b.add({ turnId: 1, text: "", confidence: 0, at: 0, session: 1, promoted: false });
    b.add({ turnId: 1, text: "hello", confidence: 0, at: 0, session: 1, promoted: false });
    expect(b.text(1)).toBe("hello");
  });
});
