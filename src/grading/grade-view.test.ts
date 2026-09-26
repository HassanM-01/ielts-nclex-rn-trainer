import { describe, expect, it } from "vitest";
import { SAMPLE_GRADE } from "../shared/grade.fixture";
import { gradeView } from "./grade-view";
import { parsePartialJson } from "./partial-json";

const JSON_TEXT = JSON.stringify(SAMPLE_GRADE);
const at = (key: string) => JSON_TEXT.indexOf(`"${key}"`);

describe("gradeView", () => {
  it("shows nothing before the first criterion closes", () => {
    const v = gradeView(parsePartialJson(JSON_TEXT.slice(0, at("lexical_resource") - 5)), null);
    expect(v.criteria.fluency_coherence).toBeNull();
    expect(v.overall).toBeNull();
  });

  it("shows each criterion as it closes, and the overall once all three are in", () => {
    const one = gradeView(parsePartialJson(JSON_TEXT.slice(0, at("lexical_resource"))), null);
    expect(one.criteria.fluency_coherence).toEqual(SAMPLE_GRADE.fluency_coherence);
    expect(one.criteria.lexical_resource).toBeNull();
    expect(one.overall).toBeNull();

    const three = gradeView(parsePartialJson(JSON_TEXT.slice(0, at("pronunciation_proxy"))), null);
    expect(three.criteria.grammatical_range).toEqual(SAMPLE_GRADE.grammatical_range);
    expect(three.overall).toBe(5.5);
    expect(three.fixes).toBeNull();
  });

  it("shows the fixes and focus when they close; the long sections at the end", () => {
    const v = gradeView(parsePartialJson(JSON_TEXT.slice(0, at("upgraded_answers"))), null);
    expect(v.fixes).toEqual(SAMPLE_GRADE.top_fixes_es);
    expect(v.focus).toBe(SAMPLE_GRADE.next_focus_es);
    expect(v.upgraded).toBeNull();

    const done = gradeView(parsePartialJson(JSON_TEXT), SAMPLE_GRADE);
    expect(done.upgraded).toEqual(SAMPLE_GRADE.upgraded_answers);
    expect(done.vocab).toEqual(SAMPLE_GRADE.vocab_to_learn);
    expect(done.pronunciation).toEqual(SAMPLE_GRADE.pronunciation_proxy);
  });
});
