import { describe, expect, it } from "vitest";
import { buildExaminerMessage, examinerSystemPrompt, parseExaminerRequest } from "./examiner-prompt";

const VALID = {
  kind: "turn",
  part2Prompt: "Describe a noisy place you have been to.",
  questions: ["What are the noisiest places in your town or city?", "Do people complain about noise?"],
  index: 0,
  exchange: [
    { role: "examiner", text: "What are the noisiest places in your town or city?" },
    { role: "candidate", text: "the market because of the music and the buses" },
  ],
  secondsLeft: 230,
  followupsUsed: 0,
  allowance: "1-per-question",
};

describe("parseExaminerRequest", () => {
  it("accepts a valid turn and a ping", () => {
    expect(parseExaminerRequest(VALID)).toEqual(VALID);
    expect(parseExaminerRequest({ kind: "ping" })).toEqual({ kind: "ping" });
  });

  it("rejects malformed input", () => {
    for (const bad of [
      null,
      "text",
      { kind: "other" },
      { ...VALID, questions: [] },
      { ...VALID, index: 5 },
      { ...VALID, index: 0.5 },
      { ...VALID, exchange: [] },
      { ...VALID, exchange: [{ role: "system", text: "hi" }] },
      { ...VALID, allowance: "unlimited" },
      { ...VALID, secondsLeft: "lots" },
      { ...VALID, part2Prompt: "x".repeat(401) },
      { ...VALID, questions: Array(13).fill("q?") },
    ]) {
      expect(parseExaminerRequest(bad)).toBeNull();
    }
  });
});

describe("buildExaminerMessage", () => {
  it("contains only the Part 2 topic, the Part 3 questions and the Part 3 exchange", () => {
    const msg = buildExaminerMessage(parseExaminerRequest(VALID) as never);
    expect(msg).toContain("Part 2 topic: Describe a noisy place you have been to.");
    expect(msg).toContain("1. What are the noisiest places in your town or city?   <- just answered");
    expect(msg).toContain("Candidate: the market because of the music and the buses");
    expect(msg).toContain("Time left in Part 3: 230 seconds ([END] is not allowed)");
    expect(msg).toContain("at most one follow-up per listed question");
  });

  it("allows [END] only under 45 seconds", () => {
    const msg = buildExaminerMessage(parseExaminerRequest({ ...VALID, secondsLeft: 30 }) as never);
    expect(msg).toContain("30 seconds ([END] is allowed)");
  });
});

describe("examinerSystemPrompt", () => {
  it("loads api/prompts/examiner.md with the output contract", () => {
    const p = examinerSystemPrompt();
    expect(p).toContain("[NEXT]");
    expect(p).toContain("[END]");
    expect(p).toContain("25 words or fewer");
  });
});
