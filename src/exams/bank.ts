// IELTS question bank shape (SPEC 9, "Shape"). The bank lives in
// data/bank/ielts/*.json and ships with the server functions, not the
// browser bundle; /api/session-start returns only the selected items.

import type { Part1Topic } from "./ielts";
import type { CueCard, HelpPhrase, Part3Set } from "./types";

/** The eight Client Needs areas of the 2026 NCLEX-RN Test Plan. */
export const NCLEX_AREAS = [
  "Management of Care",
  "Safety and Infection Prevention and Control",
  "Health Promotion and Maintenance",
  "Psychosocial Integrity",
  "Basic Care and Comfort",
  "Pharmacological and Parenteral Therapies",
  "Reduction of Risk Potential",
  "Physiological Adaptation",
] as const;

export type NclexArea = (typeof NCLEX_AREAS)[number];

export type Gloss = HelpPhrase;

export interface BankPart1Topic extends Part1Topic {
  /** "season" for the season file, "evergreen" otherwise. */
  tags: string[];
}

export interface BankCard extends CueCard {
  /** "season" | "evergreen", plus "health" for health cards. */
  tags: string[];
  nclex_area: NclexArea | "none";
  part3_id: string;
  useful_words: Gloss[];
  help: Gloss[];
}

export interface BankFile {
  /** "evergreen" or a season id like "2026-09" (Sep–Dec 2026). */
  season: string;
  /** Last day of the season (YYYY-MM-DD); null for evergreen. */
  ends: string | null;
  part1: BankPart1Topic[];
  part2: BankCard[];
  part3: Part3Set[];
}

export const EVERGREEN = "evergreen";
