// Question selection for /api/session-start (SPEC 9, "Selection"). Pure:
// the random source, clock and history are passed in.
//
// Part 1: one opening topic (Work most often) plus two others, preferring
// the current season. Part 2: about 60% current season, 25% health, 15%
// evergreen general, never a recent card; its linked Part 3 set. Part 3 is
// ordered by level in the browser (buildIeltsScript), from the same data.

import type { BankCard, BankFile, BankPart1Topic } from "../../src/exams/bank";
import type { IeltsItems } from "../../src/exams/ielts";
import { pickSeason } from "./season.js";

export const PART2_WEIGHTS = { season: 0.6, health: 0.25, evergreen: 0.15 } as const;
/** "Work (most often, since Julio works)": weights for the opening topic. */
export const OPENING_WEIGHTS: Record<string, number> = { "p1-work": 0.5, "p1-home": 0.25, "p1-hometown": 0.25 };

export interface SelectOptions {
  now: Date;
  /** Julio's IELTS test date, if set. */
  testDate?: Date | null;
  /** Topic and card ids used recently (from the database, step 6). */
  recent?: { part1?: readonly string[]; part2?: readonly string[] };
  random?: () => number;
}

export interface Selection {
  items: IeltsItems;
  season: string | null;
}

function pick<T>(list: readonly T[], random: () => number): T | undefined {
  return list[Math.floor(random() * list.length)];
}

function pickWeighted<T>(list: readonly T[], weight: (t: T) => number, random: () => number): T | undefined {
  const total = list.reduce((s, t) => s + weight(t), 0);
  if (total <= 0) return pick(list, random);
  let r = random() * total;
  for (const t of list) {
    r -= weight(t);
    if (r < 0) return t;
  }
  return list[list.length - 1];
}

function pickN<T>(list: readonly T[], n: number, random: () => number): T[] {
  const pool = [...list];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    const i = Math.floor(random() * pool.length);
    out.push(...pool.splice(i, 1));
  }
  return out;
}

const isHealth = (c: BankCard) => c.tags.includes("health");

/** Returns null if the bank can't produce a full set (the browser then uses its fixed set). */
export function selectItems(bank: readonly BankFile[], opts: SelectOptions): Selection | null {
  const random = opts.random ?? Math.random;
  const recent1 = new Set(opts.recent?.part1 ?? []);
  const recent2 = new Set(opts.recent?.part2 ?? []);
  const evergreen = bank.filter((f) => f.season === "evergreen");
  const season = pickSeason(
    bank.filter((f) => f.season !== "evergreen"),
    opts.now,
    opts.testDate ?? null,
  );

  // ---- Part 1 ----
  const all1 = (files: readonly BankFile[]) => files.flatMap((f) => f.part1);
  const fresh1 = (list: BankPart1Topic[]) => {
    const f = list.filter((t) => !recent1.has(t.id));
    return f.length > 0 ? f : list;
  };
  const openings = fresh1(all1(bank).filter((t) => t.opening));
  const opening = pickWeighted(openings, (t) => OPENING_WEIGHTS[t.id] ?? 0.1, random);
  const others: BankPart1Topic[] = [];
  const seasonTopics = fresh1((season?.part1 ?? []).filter((t) => !t.opening));
  others.push(...pickN(seasonTopics, 2, random));
  if (others.length < 2) {
    const ever = fresh1(all1(evergreen).filter((t) => !t.opening && !others.includes(t)));
    others.push(...pickN(ever, 2 - others.length, random));
  }
  if (!opening || others.length < 2) return null;

  // ---- Part 2 ----
  const fresh2 = (list: BankCard[]) => list.filter((c) => !recent2.has(c.id));
  const buckets: Record<keyof typeof PART2_WEIGHTS, BankCard[]> = {
    season: fresh2((season?.part2 ?? []).filter((c) => !isHealth(c))),
    health: fresh2(bank.flatMap((f) => f.part2).filter(isHealth)),
    evergreen: fresh2(evergreen.flatMap((f) => f.part2).filter((c) => !isHealth(c))),
  };
  // A season past its end date is not picked above, so its share goes to
  // evergreen general automatically: its bucket is empty.
  const weights = { ...PART2_WEIGHTS } as Record<keyof typeof PART2_WEIGHTS, number>;
  if (buckets.season.length === 0) {
    weights.evergreen += weights.season;
    weights.season = 0;
  }
  const available = (Object.keys(buckets) as (keyof typeof buckets)[]).filter((k) => buckets[k].length > 0 && weights[k] > 0);
  const bucket = pickWeighted(available, (k) => weights[k], random);
  const card = bucket ? pick(buckets[bucket], random) : undefined;
  if (!card) return null;
  const part3 = bank.flatMap((f) => f.part3).find((s) => s.id === card.part3_id);
  if (!part3) return null;

  return {
    items: {
      part1: [opening, ...others].map(({ id, topic, opening: o, intro, questions }) => ({ id, topic, opening: o, intro, questions })),
      part2: { id: card.id, prompt: card.prompt, bullets: card.bullets, explain: card.explain, roundoff: card.roundoff },
      part3,
    },
    season: season?.season ?? null,
  };
}
