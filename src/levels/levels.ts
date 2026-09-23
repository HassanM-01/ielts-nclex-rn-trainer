// Difficulty levels (SPEC 7, "Niveles"). Levels change support, pacing and
// feedback targets, never which topics Julio gets. Step 2 runs everything at
// Nivel 3; step 7 wires the other levels into the UI.

export type LevelId = 1 | 2 | 3;

export type ExamMode = "full" | "part1" | "parts23" | "quick" | "clinical";

export interface LevelDef {
  id: LevelId;
  /** CEFR range the level trains toward. */
  cefr: string;
  /** Examiner speech rate. */
  rate: number;
  part2PrepMs: number;
  /** Part 2 speaking goal; the hard stop stays at 2:00. */
  part2GoalMs: number;
  usefulWords: "always" | "first-2" | "never";
  help: boolean;
  part3Order: "concrete-first-max-1-abstract" | "2-concrete-then-abstract" | "real";
  /** Part 3 follow-ups allowed: per part, per 2 questions, or per question. */
  part3Followups: "1-per-part" | "1-per-2-questions" | "1-per-question";
  /** Added to every endpointing silence. */
  extraPatienceMs: number;
  upgradeBand: number;
  clinicalVignette: { words: [number, number]; textShown: "while-read" | "after-read"; glosses: "shown" | "on-tap" | "none" };
  clinicalDifficulties: number[];
}

export const LEVELS: Record<LevelId, LevelDef> = {
  1: {
    id: 1,
    cefr: "B1–B2",
    rate: 0.85,
    part2PrepMs: 120_000,
    part2GoalMs: 60_000,
    usefulWords: "always",
    help: true,
    part3Order: "concrete-first-max-1-abstract",
    part3Followups: "1-per-part",
    extraPatienceMs: 1_000,
    upgradeBand: 6,
    clinicalVignette: { words: [50, 60], textShown: "while-read", glosses: "shown" },
    clinicalDifficulties: [1, 2],
  },
  2: {
    id: 2,
    cefr: "B2–C1",
    rate: 0.9,
    part2PrepMs: 90_000,
    part2GoalMs: 90_000,
    usefulWords: "first-2",
    help: true,
    part3Order: "2-concrete-then-abstract",
    part3Followups: "1-per-2-questions",
    extraPatienceMs: 500,
    upgradeBand: 7,
    clinicalVignette: { words: [60, 90], textShown: "after-read", glosses: "on-tap" },
    clinicalDifficulties: [1, 2, 3],
  },
  3: {
    id: 3,
    cefr: "Examen real",
    rate: 1.0,
    part2PrepMs: 60_000,
    part2GoalMs: 120_000,
    usefulWords: "never",
    help: false,
    part3Order: "real",
    part3Followups: "1-per-question",
    extraPatienceMs: 0,
    upgradeBand: 7.5,
    clinicalVignette: { words: [60, 90], textShown: "after-read", glosses: "none" },
    clinicalDifficulties: [2, 3],
  },
};

/** Until placement, start at Nivel 2. */
export const DEFAULT_LEVEL: LevelId = 2;

/**
 * The level whose conditions a session runs under. "Examen completo" always
 * runs at Nivel 3 so its bands stay comparable over time.
 */
export function conditionsLevel(mode: ExamMode, level: LevelId): LevelId {
  return mode === "full" ? 3 : level;
}
