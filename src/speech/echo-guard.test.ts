import { describe, expect, it } from "vitest";
import { nonEchoWordCount, shouldBargeIn, trimEcho } from "./echo-guard";

describe("trimEcho", () => {
  const line = "Do you work or are you a student?";

  it("strips a leading run matching the tail of the examiner's line", () => {
    expect(trimEcho(line, "a student I work as a nurse")).toBe("I work as a nurse");
    expect(trimEcho(line, "are you a student I'm a nurse")).toBe("I'm a nurse");
  });
  it("strips a whole result that is only echo", () => {
    expect(trimEcho(line, "or are you a student")).toBe("");
  });
  it("ignores case and punctuation", () => {
    expect(trimEcho(line, "A Student? Yes, I work")).toBe("Yes, I work");
  });
  it("does not strip a single matching word", () => {
    expect(trimEcho("What do you like about it?", "it is a nice place")).toBe("it is a nice place");
  });
  it("leaves answers that don't start with echo alone", () => {
    expect(trimEcho(line, "I work in a hospital")).toBe("I work in a hospital");
  });
  it("handles an empty examiner line", () => {
    expect(trimEcho("", "hello there")).toBe("hello there");
  });
});

describe("nonEchoWordCount", () => {
  const line = "Do you work or are you a student?";
  it("ignores the examiner's own words picked up by the mic", () => {
    expect(nonEchoWordCount(line, "are you a student")).toBe(0);
    expect(nonEchoWordCount(line, "you a student")).toBe(0);
  });
  it("counts Julio's words", () => {
    expect(nonEchoWordCount(line, "sorry sorry")).toBe(2);
    expect(nonEchoWordCount(line, "yes I work")).toBe(2);
  });
});

describe("shouldBargeIn", () => {
  const base = { headphones: true, examinerSpeaking: true, interruptible: true, vadVoiced: true, recognizedWords: 2 };

  it("needs headphones, voice and at least 2 words", () => {
    expect(shouldBargeIn(base)).toBe(true);
    expect(shouldBargeIn({ ...base, headphones: false })).toBe(false);
    expect(shouldBargeIn({ ...base, recognizedWords: 1 })).toBe(false);
    expect(shouldBargeIn({ ...base, vadVoiced: false })).toBe(false);
  });
  it("never interrupts an examiner interruption", () => {
    expect(shouldBargeIn({ ...base, interruptible: false })).toBe(false);
  });
  it("only while the examiner is speaking", () => {
    expect(shouldBargeIn({ ...base, examinerSpeaking: false })).toBe(false);
  });
  it("falls back to the word count when the VAD is unavailable", () => {
    expect(shouldBargeIn({ ...base, vadVoiced: null })).toBe(true);
  });
});
