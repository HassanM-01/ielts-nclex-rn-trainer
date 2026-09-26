// What the results screen can show from a grading job, section by section:
// each criterion once its object has closed in the stream (SPEC 11), the
// overall once all three are in, and the rest as it closes or at the end.
// Pure.

import { CRITERIA, normalizeCriterion, overallBand, strings, type Criterion, type CriterionKey, type Grade } from "../shared/grade";
import type { PartialResult } from "./partial-json";

export interface GradeView {
  criteria: Record<CriterionKey, Criterion | null>;
  /** Mean of the three, rounded down to a half band; null until all three are in. */
  overall: number | null;
  fixes: string[] | null;
  focus: string | null;
  /** Only with the final grade (long sections; they arrive last anyway). */
  pronunciation: Grade["pronunciation_proxy"] | null;
  upgraded: Grade["upgraded_answers"] | null;
  vocab: Grade["vocab_to_learn"] | null;
}

export function gradeView(partial: PartialResult, grade: Grade | null): GradeView {
  if (grade) {
    return {
      criteria: { fluency_coherence: grade.fluency_coherence, lexical_resource: grade.lexical_resource, grammatical_range: grade.grammatical_range },
      overall: overallBand(CRITERIA.map((k) => grade[k].band)),
      fixes: grade.top_fixes_es,
      focus: grade.next_focus_es,
      pronunciation: grade.pronunciation_proxy,
      upgraded: grade.upgraded_answers,
      vocab: grade.vocab_to_learn,
    };
  }
  const v = partial.value && typeof partial.value === "object" ? (partial.value as Record<string, unknown>) : {};
  const closed = new Set(partial.closedKeys);
  const section = <T>(key: string, read: (x: unknown) => T | null): T | null => (closed.has(key) ? read(v[key]) : null);
  const criteria = {
    fluency_coherence: section("fluency_coherence", normalizeCriterion),
    lexical_resource: section("lexical_resource", normalizeCriterion),
    grammatical_range: section("grammatical_range", normalizeCriterion),
  };
  const bands = CRITERIA.map((k) => criteria[k]?.band).filter((b): b is number => b !== undefined);
  const fixes = section("top_fixes_es", strings);
  return {
    criteria,
    overall: bands.length === CRITERIA.length ? overallBand(bands) : null,
    fixes: fixes ? fixes.slice(0, 3) : null,
    focus: section("next_focus_es", (x) => (typeof x === "string" ? x : null)),
    pronunciation: null,
    upgraded: null,
    vocab: null,
  };
}
