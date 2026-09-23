import { describe, expect, it } from "vitest";
import { isRepeatRequest } from "./voice-commands";

describe("isRepeatRequest", () => {
  it.each([
    "Sorry?",
    "sorry",
    "Pardon?",
    "Pardon me?",
    "Excuse me?",
    "I'm sorry?",
    "Sorry, what?",
    "What?",
    "Can you repeat that?",
    "Could you say that again?",
    "Could you say that again, please?",
    "Repeat the question, please.",
    "Can you repeat the question?",
    "Sorry, can you repeat that?",
    "What do you mean?",
    "Sorry, what do you mean?",
    "I didn't catch that.",
    "Come again?",
    "Um, sorry?",
  ])("treats %j as a repeat request", (text) => {
    expect(isRepeatRequest(text)).toBe(true);
  });

  it.each([
    "Sorry, I don't really like shoes",
    "Sorry I don't know",
    "I'm sorry but I work at night",
    "What I like most is the people",
    "Repeat customers are important",
    "I work as a nurse",
    "",
  ])("treats %j as an answer", (text) => {
    expect(isRepeatRequest(text)).toBe(false);
  });

  it("needs 6 words or fewer", () => {
    expect(isRepeatRequest("Sorry, could you repeat the question, please?")).toBe(false); // 7 words
    expect(isRepeatRequest("Could you repeat the question, please?")).toBe(true); // 6 words
  });
});
