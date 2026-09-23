import { describe, expect, it } from "vitest";
import { countWords, normalizeWords, splitSentences } from "./text";

describe("normalizeWords", () => {
  it("lowercases, strips punctuation, keeps apostrophes", () => {
    expect(normalizeWords("Sorry, I DON'T really like shoes!")).toEqual(["sorry", "i", "don't", "really", "like", "shoes"]);
  });
  it("handles curly apostrophes and hyphens", () => {
    expect(normalizeWords("It’s well-known")).toEqual(["it's", "well", "known"]);
  });
  it("counts words", () => {
    expect(countWords("  one two   three ")).toBe(3);
    expect(countWords("")).toBe(0);
  });
});

describe("splitSentences", () => {
  it("splits on sentence punctuation", () => {
    expect(splitSentences("Good afternoon. My name is Sonia. Can you tell me your full name, please?")).toEqual([
      "Good afternoon.",
      "My name is Sonia.",
      "Can you tell me your full name, please?",
    ]);
  });
  it("keeps abbreviations and decimals inside a sentence", () => {
    expect(splitSentences("Dr. Smith said 3.5 is fine, e.g. for Mr. Lee. Next one!")).toEqual([
      "Dr. Smith said 3.5 is fine, e.g. for Mr. Lee.",
      "Next one!",
    ]);
  });
  it("keeps trailing text without punctuation", () => {
    expect(splitSentences("Thank you. And now")).toEqual(["Thank you.", "And now"]);
  });
  it("returns nothing for blank input", () => {
    expect(splitSentences("   ")).toEqual([]);
  });
});
