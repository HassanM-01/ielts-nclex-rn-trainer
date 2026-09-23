import { describe, expect, it } from "vitest";
import { PART3_DISCUSSION } from "../exams/ielts";
import { FIXED_SET } from "../exams/ielts-fixed-set";
import { canReuseSpeculative, followupAllowed, orderPart3, parseExaminerReply, part3SecondsLeft, shouldEndPart3 } from "./part3";

describe("parseExaminerReply", () => {
  it("reads the two control tokens", () => {
    expect(parseExaminerReply("[NEXT]", 200)).toEqual({ type: "next" });
    expect(parseExaminerReply("  [NEXT]\n", 200)).toEqual({ type: "next" });
    expect(parseExaminerReply("[END]", 30)).toEqual({ type: "end" });
  });

  it("only lets the model end Part 3 with under 45 s left", () => {
    expect(parseExaminerReply("[END]", 60)).toEqual({ type: "next" });
  });

  it("accepts one short follow-up question", () => {
    expect(parseExaminerReply("Why do you think traffic is the main problem?", 200)).toEqual({
      type: "followup",
      text: "Why do you think traffic is the main problem?",
    });
    expect(parseExaminerReply("You mentioned your neighbours. How do people usually solve that?", 200)?.type).toBe("followup");
    expect(parseExaminerReply('Examiner: "Can you give me an example?"', 200)).toEqual({ type: "followup", text: "Can you give me an example?" });
  });

  it("rejects praise, feedback, several questions and long or odd output", () => {
    for (const bad of [
      "Good point. Why do you think that is?",
      "Interesting. Can you give me an example?",
      "Thank you. Why is that?",
      "Why? And how would you change it?",
      "Your answer was clear. Why do people complain?",
      "Do you think the many different kinds of noise in modern cities, from traffic and construction to music and crowds, affect older people more than they affect younger people today?",
      "Why do you think that is",
      "- Why is that?\n- Give an example",
      "[FOLLOWUP] Why?",
      "",
    ]) {
      expect(parseExaminerReply(bad, 200), bad).toBeNull();
    }
  });

  it("allows neutral questions that happen to contain an evaluative word", () => {
    expect(parseExaminerReply("Do you think that is a good thing for society?", 200)?.type).toBe("followup");
  });
});

describe("followupAllowed", () => {
  it("allows at most one per listed question", () => {
    expect(followupAllowed("1-per-question", 3, 3, false)).toBe(true);
    expect(followupAllowed("1-per-question", 3, 3, true)).toBe(false);
  });
  it("Nivel 2: at most one per two questions", () => {
    expect(followupAllowed("1-per-2-questions", 0, 0, false)).toBe(true);
    expect(followupAllowed("1-per-2-questions", 1, 1, false)).toBe(false);
    expect(followupAllowed("1-per-2-questions", 2, 1, false)).toBe(true);
  });
  it("Nivel 1: at most one in the whole part", () => {
    expect(followupAllowed("1-per-part", 0, 0, false)).toBe(true);
    expect(followupAllowed("1-per-part", 4, 1, false)).toBe(false);
  });
});

describe("orderPart3", () => {
  const qs = FIXED_SET.part3!.questions;
  it("keeps the real order at Nivel 3", () => {
    expect(orderPart3(qs, "real")).toEqual(qs);
  });
  it("puts 2 concrete questions first at Nivel 2", () => {
    const shuffled = [qs[2]!, qs[0]!, qs[3]!, qs[1]!];
    expect(orderPart3(shuffled, "2-concrete-then-abstract").map((q) => q.kind)).toEqual(["concrete", "concrete", "abstract", "abstract"]);
  });
  it("uses concrete questions and at most one abstract at Nivel 1", () => {
    expect(orderPart3(qs, "concrete-first-max-1-abstract").map((q) => q.kind)).toEqual(["concrete", "concrete", "abstract"]);
  });
});

describe("Part 3 timing", () => {
  it("ends after 4:30 once at least 4 listed questions were asked", () => {
    expect(shouldEndPart3(269_999, 5, PART3_DISCUSSION)).toBe(false);
    expect(shouldEndPart3(270_000, 3, PART3_DISCUSSION)).toBe(false);
    expect(shouldEndPart3(270_000, 4, PART3_DISCUSSION)).toBe(true);
  });
  it("reports seconds left out of 5 minutes", () => {
    expect(part3SecondsLeft(0, PART3_DISCUSSION)).toBe(300);
    expect(part3SecondsLeft(280_000, PART3_DISCUSSION)).toBe(20);
    expect(part3SecondsLeft(400_000, PART3_DISCUSSION)).toBe(0);
  });
});

describe("canReuseSpeculative", () => {
  it("reuses when the answer grew by 3 words or fewer", () => {
    expect(canReuseSpeculative(20, 20)).toBe(true);
    expect(canReuseSpeculative(20, 23)).toBe(true);
    expect(canReuseSpeculative(20, 24)).toBe(false);
  });
});
