// Bank validation (SPEC 16): schema, counts, links, distribution. The
// per-item checks also run inside bank:build, so a bad item is regenerated
// straight away instead of waiting for bank:validate.

import { NCLEX_AREAS, type BankCard, type BankFile, type BankPart1Topic, type Gloss } from "../../src/exams/bank";
import type { Part3Set } from "../../src/exams/types";
import { inSeason } from "../../api/_lib/season";
import { countWords } from "../../src/speech/text";

export const MINIMUMS = {
  part1Topics: 40,
  part2Cards: 50,
  seasonCards: 20,
  healthCards: 12,
  usefulWords: 5,
  helpPhrases: 3,
  part3Concrete: 2,
  part3Abstract: 2,
} as const;

const isQuestion = (s: string) => typeof s === "string" && s.trim().endsWith("?") && countWords(s) >= 3;
const glossOk = (g: Gloss) => !!g && typeof g.en === "string" && g.en.trim() !== "" && typeof g.es === "string" && g.es.trim() !== "";

export function checkPart1Topic(t: BankPart1Topic): string[] {
  const p: string[] = [];
  if (!t.topic?.trim()) p.push("missing topic name");
  if (!Array.isArray(t.questions) || t.questions.length < 3 || t.questions.length > 5) p.push("needs 3 to 5 questions");
  else t.questions.forEach((q, i) => !isQuestion(q) && p.push(`question ${i + 1} is not a question`));
  if (t.intro !== undefined && !t.intro.trim()) p.push("empty intro");
  return p;
}

export function checkPart3Set(s: Part3Set): string[] {
  const p: string[] = [];
  if (!s.theme?.trim()) p.push("Part 3 set has no theme");
  const qs = Array.isArray(s.questions) ? s.questions : [];
  if (qs.length < 4 || qs.length > 6) p.push("Part 3 set needs 4 to 6 questions");
  const concrete = qs.filter((q) => q.kind === "concrete").length;
  const abstract = qs.filter((q) => q.kind === "abstract").length;
  if (concrete < MINIMUMS.part3Concrete) p.push(`Part 3 set needs at least ${MINIMUMS.part3Concrete} concrete questions`);
  if (abstract < MINIMUMS.part3Abstract) p.push(`Part 3 set needs at least ${MINIMUMS.part3Abstract} abstract questions`);
  qs.forEach((q, i) => {
    const n = `Part 3 question ${i + 1}`;
    if (!isQuestion(q.q)) p.push(`${n} is not a question`);
    if (!isQuestion(q.rephrase)) p.push(`${n} has no rephrase question`);
    if (!Array.isArray(q.followups) || q.followups.length < 1 || !q.followups.every(isQuestion)) p.push(`${n} needs follow-up questions`);
    if (!Array.isArray(q.help) || q.help.length !== MINIMUMS.helpPhrases || !q.help.every(glossOk)) p.push(`${n} needs ${MINIMUMS.helpPhrases} help phrases`);
  });
  return p;
}

export function checkCard(c: BankCard, set: Part3Set | undefined): string[] {
  const p: string[] = [];
  if (!/^Describe\s/.test(c.prompt ?? "")) p.push('prompt must start with "Describe"');
  if (!Array.isArray(c.bullets) || c.bullets.length !== 3 || c.bullets.some((b) => !b?.trim())) p.push("needs exactly 3 bullets");
  if (!/^and explain\s/i.test(c.explain ?? "")) p.push('explain line must start with "and explain"');
  if (!Array.isArray(c.roundoff) || c.roundoff.length < 1 || !c.roundoff.every(isQuestion)) p.push("needs round-off questions");
  if (!Array.isArray(c.useful_words) || c.useful_words.length !== MINIMUMS.usefulWords || !c.useful_words.every(glossOk)) {
    p.push(`needs ${MINIMUMS.usefulWords} useful words with Spanish glosses`);
  }
  if (!Array.isArray(c.help) || c.help.length !== MINIMUMS.helpPhrases || !c.help.every(glossOk)) p.push(`needs ${MINIMUMS.helpPhrases} help phrases`);
  if (c.nclex_area !== "none" && !(NCLEX_AREAS as readonly string[]).includes(c.nclex_area)) p.push(`unknown NCLEX area "${c.nclex_area}"`);
  if (c.tags.includes("health") && c.nclex_area === "none") p.push("health card without an NCLEX area");
  if (!set) p.push(`linked Part 3 set ${c.part3_id} is missing`);
  else p.push(...checkPart3Set(set));
  return p;
}

export interface ValidationReport {
  errors: string[];
  warnings: string[];
  stats: {
    part1Topics: number;
    openingTopics: number;
    part2Cards: number;
    seasonCards: number;
    healthCards: number;
    healthByArea: Record<string, number>;
    part3Sets: number;
    currentSeason: string | null;
  };
}

export function validateBank(files: readonly BankFile[], now: Date): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();
  const dup = (id: string, where: string) => {
    if (ids.has(id)) errors.push(`${where}: duplicate id ${id}`);
    ids.add(id);
  };

  for (const f of files) {
    const where = f.season;
    if (f.season !== "evergreen" && !f.ends) errors.push(`${where}: season file without an "ends" date`);
    const sets = new Map(f.part3.map((s) => [s.id, s]));
    for (const t of f.part1) {
      dup(t.id, where);
      for (const e of checkPart1Topic(t)) errors.push(`${where} ${t.id}: ${e}`);
    }
    for (const c of f.part2) {
      dup(c.id, where);
      for (const e of checkCard(c, sets.get(c.part3_id))) errors.push(`${where} ${c.id}: ${e}`);
    }
    for (const s of f.part3) {
      dup(s.id, where);
      if (!f.part2.some((c) => c.part3_id === s.id)) warnings.push(`${where} ${s.id}: Part 3 set not linked to any card`);
    }
  }

  const part1 = files.flatMap((f) => f.part1);
  const cards = files.flatMap((f) => f.part2);
  const health = cards.filter((c) => c.tags.includes("health"));
  const current = files.find((f) => f.season !== "evergreen" && inSeason(f, now)) ?? null;
  const seasonCards = current ? current.part2.length : 0;
  const openingTopics = part1.filter((t) => t.opening).length;
  const healthByArea: Record<string, number> = {};
  for (const c of health) healthByArea[c.nclex_area] = (healthByArea[c.nclex_area] ?? 0) + 1;

  if (part1.length < MINIMUMS.part1Topics) errors.push(`only ${part1.length} Part 1 topics (need ${MINIMUMS.part1Topics})`);
  if (openingTopics < 3) errors.push(`only ${openingTopics} opening topics (need Work, Home, Hometown)`);
  if (cards.length < MINIMUMS.part2Cards) errors.push(`only ${cards.length} Part 2 cards (need ${MINIMUMS.part2Cards})`);
  if (!current) errors.push(`no season file covers ${now.toISOString().slice(0, 10)}`);
  else if (seasonCards < MINIMUMS.seasonCards) errors.push(`only ${seasonCards} current-season cards (need ${MINIMUMS.seasonCards})`);
  if (health.length < MINIMUMS.healthCards) errors.push(`only ${health.length} health cards (need ${MINIMUMS.healthCards})`);
  const missingAreas = NCLEX_AREAS.filter((a) => !healthByArea[a]);
  if (missingAreas.length) warnings.push(`no health card for: ${missingAreas.join(", ")}`);

  return {
    errors,
    warnings,
    stats: {
      part1Topics: part1.length,
      openingTopics,
      part2Cards: cards.length,
      seasonCards,
      healthCards: health.length,
      healthByArea,
      part3Sets: files.reduce((n, f) => n + f.part3.length, 0),
      currentSeason: current?.season ?? null,
    },
  };
}
