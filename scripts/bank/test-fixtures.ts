// Small valid bank items for tests (not shipped anywhere).

import type { BankCard, BankFile, BankPart1Topic } from "../../src/exams/bank";
import type { Part3Set } from "../../src/exams/types";

const g = (en: string) => ({ en, es: `es: ${en}` });

export function topic(id: string, opening = false, tag = "evergreen"): BankPart1Topic {
  return {
    id,
    topic: id.replace(/^p1-/, ""),
    opening,
    intro: "Let's talk about this.",
    questions: ["Do you like this topic?", "How often do you do it?", "Why do you like it?", "Would you like to do more?"],
    tags: [tag],
  };
}

export function set(id: string): Part3Set {
  const q = (kind: "concrete" | "abstract", n: number) => ({
    q: `What do people in your country think about thing ${n}?`,
    kind,
    rephrase: `How do people where you live feel about thing ${n}?`,
    followups: ["Why do you think that is?", "Can you give me an example?"],
    help: [g("I'd say that"), g("On the one hand"), g("For example")],
  });
  return { id, theme: "A theme", questions: [q("concrete", 1), q("concrete", 2), q("abstract", 3), q("abstract", 4), q("abstract", 5)] };
}

export function card(id: string, tag = "evergreen", health: string | null = null): BankCard {
  return {
    id,
    prompt: "Describe a place you like.",
    bullets: ["where it is", "when you go there", "what you do there"],
    explain: "and explain why you like it.",
    roundoff: ["Do you go there often?", "Would you take a friend there?"],
    tags: health ? [tag, "health"] : [tag],
    nclex_area: (health ?? "none") as BankCard["nclex_area"],
    part3_id: id.replace(/^p2-/, "p3-"),
    useful_words: [g("bustling"), g("tranquil"), g("vibrant"), g("crowded"), g("peaceful")],
    help: [g("What really stood out was"), g("Another thing I remember is"), g("All in all")],
  };
}

export function file(season: string, ends: string | null, part1: BankPart1Topic[], cards: BankCard[]): BankFile {
  return { season, ends, part1, part2: cards, part3: cards.map((c) => set(c.part3_id)) };
}

/** A bank that meets every SPEC 16 minimum for dates in Sep–Dec 2026. */
export function fullBank(): BankFile[] {
  const everTopics = [topic("p1-work", true), topic("p1-home", true), topic("p1-hometown", true)];
  for (let i = 0; i < 27; i++) everTopics.push(topic(`p1-ever-${i}`));
  const seasonTopics = Array.from({ length: 13 }, (_, i) => topic(`p1-season-${i}`, false, "season"));
  const everCards = Array.from({ length: 18 }, (_, i) => card(`p2-ever-${i}`));
  const areas = [
    "Management of Care",
    "Safety and Infection Prevention and Control",
    "Health Promotion and Maintenance",
    "Psychosocial Integrity",
    "Basic Care and Comfort",
    "Pharmacological and Parenteral Therapies",
    "Reduction of Risk Potential",
    "Physiological Adaptation",
  ];
  const health = Array.from({ length: 12 }, (_, i) => card(`p2-health-${i}`, "evergreen", areas[i % areas.length]!));
  const seasonCards = Array.from({ length: 22 }, (_, i) => card(`p2-season-${i}`, "season"));
  return [file("evergreen", null, everTopics, [...everCards, ...health]), file("2026-09", "2026-12-31", seasonTopics, seasonCards)];
}
