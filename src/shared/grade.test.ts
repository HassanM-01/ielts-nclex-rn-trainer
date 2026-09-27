import { describe, expect, it } from "vitest";
import { gradeOverall, normalizeGrade, overallBand } from "./grade";
import { SAMPLE_GRADE } from "./grade.fixture";

describe("overall band (SPEC 11)", () => {
  it("is the mean rounded DOWN to the nearest half band", () => {
    expect(overallBand([6, 6, 7])).toBe(6); // 6.33
    expect(overallBand([6, 7, 7])).toBe(6.5); // 6.67
    expect(overallBand([7, 7, 7])).toBe(7);
    expect(overallBand([6, 7])).toBe(6.5);
    expect(overallBand([8, 8, 9])).toBe(8); // 8.33
    expect(overallBand([5, 6, 8])).toBe(6.0); // 6.33
    expect(overallBand([])).toBeNull();
  });

  it("uses the three graded criteria", () => {
    expect(gradeOverall(SAMPLE_GRADE)).toBe(5.5); // 5.67
  });
});

describe("normalizeGrade", () => {
  it("accepts a schema-valid grade unchanged", () => {
    expect(normalizeGrade(JSON.parse(JSON.stringify(SAMPLE_GRADE)))).toEqual(SAMPLE_GRADE);
  });

  it("rejects a grade missing a criterion or with a non-numeric band", () => {
    const { lexical_resource: _, ...missing } = SAMPLE_GRADE;
    expect(normalizeGrade(missing)).toBeNull();
    expect(normalizeGrade({ ...SAMPLE_GRADE, fluency_coherence: { ...SAMPLE_GRADE.fluency_coherence, band: "6" } })).toBeNull();
    expect(normalizeGrade(null)).toBeNull();
    expect(normalizeGrade([])).toBeNull();
  });

  it("keeps bands whole and within 0 to 9, rounding down", () => {
    const g = normalizeGrade({
      ...SAMPLE_GRADE,
      fluency_coherence: { ...SAMPLE_GRADE.fluency_coherence, band: 6.5 },
      lexical_resource: { ...SAMPLE_GRADE.lexical_resource, band: 12 },
      grammatical_range: { ...SAMPLE_GRADE.grammatical_range, band: -1 },
    });
    expect([g?.fluency_coherence.band, g?.lexical_resource.band, g?.grammatical_range.band]).toEqual([6, 9, 0]);
  });

  it("matches enums case-insensitively and falls back safely", () => {
    const g = normalizeGrade({
      ...SAMPLE_GRADE,
      vocab_to_learn: [
        { word: "a", es: "b", example: "c", exam: "NCLEX", nclex_area: "management of care" },
        { word: "d", es: "e", example: "f", exam: "toefl", nclex_area: "Cardiology" },
        { word: "", es: "x", example: "y", exam: "ielts", nclex_area: "none" },
      ],
    });
    expect(g?.vocab_to_learn).toEqual([
      { word: "a", es: "b", example: "c", exam: "nclex", nclex_area: "Management of Care" },
      { word: "d", es: "e", example: "f", exam: "ielts", nclex_area: "none" },
    ]);
  });

  it("drops the model's own quotation marks around evidence (the screen adds them)", () => {
    const g = normalizeGrade({
      ...SAMPLE_GRADE,
      fluency_coherence: { ...SAMPLE_GRADE.fluency_coherence, evidence: ['"So. We were brought up."', "“it depends”", "don't \"stop\" here", '""'] },
    });
    expect(g?.fluency_coherence.evidence).toEqual(["So. We were brought up.", "it depends", 'don\'t "stop" here']);
  });

  it("keeps at most 3 fixes and 2 upgraded answers", () => {
    const u = SAMPLE_GRADE.upgraded_answers[0]!;
    const g = normalizeGrade({ ...SAMPLE_GRADE, top_fixes_es: ["1", "2", "3", "4"], upgraded_answers: [u, u, u] });
    expect(g?.top_fixes_es).toHaveLength(3);
    expect(g?.upgraded_answers).toHaveLength(2);
  });
});
