import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyBankFile, estimateCost, isBuilt, planBuild } from "./plan";
import { cardPrompt, part1Prompt, toCard, toPart1Topic } from "./prompts";
import { parseSeeds, slug } from "./seeds";
import { card, fullBank, set, topic } from "./test-fixtures";
import { checkCard, checkPart1Topic, validateBank } from "./validate";

const SEP = new Date("2026-09-25T12:00:00Z");

describe("seeds", () => {
  it("slugs titles into short ids", () => {
    expect(slug("a noisy place you have been to")).toBe("noisy-place-you-have-been-to");
    expect(slug("Home and accommodation")).toBe("home-and-accommodation");
    expect(slug("a person you met only once and would like to know more about").length).toBeLessThanOrEqual(40);
  });

  it("parses headers, sections, explicit ids and NCLEX areas", () => {
    const s = parseSeeds(
      ["season: 2026-09", "ends: 2026-12-31", "[part1-opening]", "Work | work", "[part1]", "Shoes", "[part2]", "a noisy place you have been to", "[health]", "a healthy habit you started | Health Promotion and Maintenance"].join("\n"),
    );
    expect(s.output).toBe("season-2026-09");
    expect(s.ends).toBe("2026-12-31");
    expect(s.items).toEqual([
      { kind: "part1", id: "p1-work", title: "Work", opening: true },
      { kind: "part1", id: "p1-shoes", title: "Shoes", opening: false },
      { kind: "part2", id: "p2-noisy-place-you-have-been-to", title: "a noisy place you have been to", health: false, area: "none" },
      { kind: "part2", id: "p2-healthy-habit-you-started", title: "a healthy habit you started", health: true, area: "Health Promotion and Maintenance" },
    ]);
  });

  it("rejects unknown NCLEX areas, duplicates and missing headers", () => {
    expect(() => parseSeeds("season: evergreen\n[health]\nsomething | Cardiology")).toThrow(/unknown NCLEX area/);
    expect(() => parseSeeds("season: evergreen\n[part1]\nShoes\nshoes")).toThrow(/duplicate id/);
    expect(() => parseSeeds("season: 2026-09\n[part1]\nShoes")).toThrow(/ends/);
  });

  it("parses the real seed files and they meet the SPEC 16 minimums", () => {
    const dir = join(process.cwd(), "data", "bank", "ielts", "seeds");
    const ever = parseSeeds(readFileSync(join(dir, "evergreen.txt"), "utf8"));
    const season = parseSeeds(readFileSync(join(dir, "2026-09.txt"), "utf8"));
    const all = [...ever.items, ...season.items];
    expect(all.filter((i) => i.kind === "part1").length).toBeGreaterThanOrEqual(40);
    expect(all.filter((i) => i.kind === "part2").length).toBeGreaterThanOrEqual(50);
    expect(season.items.filter((i) => i.kind === "part2").length).toBeGreaterThanOrEqual(20);
    expect(all.filter((i) => i.kind === "part2" && i.health).length).toBeGreaterThanOrEqual(12);
    expect(ever.items.filter((i) => i.kind === "part1" && i.opening).map((i) => i.id)).toEqual(["p1-work", "p1-home", "p1-hometown"]);
    expect(new Set(all.map((i) => i.id)).size).toBe(all.length);
  });
});

describe("plan", () => {
  const seeds = parseSeeds("season: evergreen\n[part1]\nShoes\nPaper\n[part2]\na noisy place");

  it("builds only what's missing", () => {
    const f = emptyBankFile(seeds);
    f.part1.push(topic("p1-shoes"));
    const tasks = planBuild([seeds], new Map([["evergreen", f]]));
    expect(tasks.map((t) => t.seed.id)).toEqual(["p1-paper", "p2-noisy-place"]);
  });

  it("treats a card without its Part 3 set as missing", () => {
    const f = emptyBankFile(seeds);
    f.part2.push(card("p2-noisy-place"));
    expect(isBuilt(f, seeds.items[2]!)).toBe(false);
    f.part3.push(set("p3-noisy-place"));
    expect(isBuilt(f, seeds.items[2]!)).toBe(true);
  });

  it("rebuilds exactly the --only ids", () => {
    const f = emptyBankFile(seeds);
    f.part1.push(topic("p1-shoes"));
    expect(planBuild([seeds], new Map([["evergreen", f]]), ["p1-shoes"]).map((t) => t.seed.id)).toEqual(["p1-shoes"]);
  });

  it("estimates the cost with the model's price", () => {
    const tasks = planBuild([seeds], new Map());
    const est = estimateCost(tasks, "claude-opus-5-5");
    expect(est.items).toEqual({ part1: 2, part2: 1 });
    expect(est.usd).toBeCloseTo((est.inputTokens * 4 + est.outputTokens * 20) / 1_000_000, 6);
    expect(estimateCost(tasks, "some-new-model").usd).toBeNull();
  });
});

describe("prompts", () => {
  it("asks for the right shape and marks health cards", () => {
    const p1 = part1Prompt({ kind: "part1", id: "p1-work", title: "Work", opening: true });
    expect(p1).toContain("Do you work or are you a student?");
    const c = cardPrompt({ kind: "part2", id: "p2-x", title: "a safety rule at work", health: true, area: "Safety and Infection Prevention and Control" });
    expect(c).toContain('"Safety and Infection Prevention and Control"');
    expect(c).toContain("at least 2 \"concrete\"");
  });

  it("maps model output to bank items with links and tags", () => {
    const t = toPart1Topic({ kind: "part1", id: "p1-shoes", title: "Shoes", opening: false }, { intro: " Now let's talk about shoes. ", questions: ["Do you like shoes? "] }, "season");
    expect(t).toMatchObject({ id: "p1-shoes", topic: "Shoes", intro: "Now let's talk about shoes.", tags: ["season"] });
    const ref = card("p2-x");
    const s = set("p3-x");
    const { card: c, set: out } = toCard(
      { kind: "part2", id: "p2-x", title: "x", health: true, area: "Basic Care and Comfort" },
      { ...ref, part3: { theme: s.theme, questions: s.questions.map((q) => ({ ...q, help: q.help ?? [] })) } },
      "evergreen",
    );
    expect(c.part3_id).toBe("p3-x");
    expect(c.tags).toEqual(["evergreen", "health"]);
    expect(c.nclex_area).toBe("Basic Care and Comfort");
    expect(out.id).toBe("p3-x");
  });
});

describe("validation", () => {
  it("accepts a complete bank", () => {
    const r = validateBank(fullBank(), SEP);
    expect(r.errors).toEqual([]);
    expect(r.stats).toMatchObject({ part1Topics: 43, openingTopics: 3, part2Cards: 52, seasonCards: 22, healthCards: 12, currentSeason: "2026-09" });
  });

  it("reports missing minimums and an out-of-date season", () => {
    const small = fullBank().map((f) => ({ ...f, part1: f.part1.slice(0, 5), part2: f.part2.slice(0, 5) }));
    const r = validateBank(small, SEP);
    expect(r.errors.join("\n")).toMatch(/Part 1 topics/);
    expect(r.errors.join("\n")).toMatch(/Part 2 cards/);
    expect(r.errors.join("\n")).toMatch(/current-season cards/);
    expect(r.errors.join("\n")).toMatch(/health cards/);
    expect(validateBank(fullBank(), new Date("2027-02-01T00:00:00Z")).errors.join("\n")).toMatch(/no season file covers 2027-02-01/);
  });

  it("checks each card: prompt, 3 bullets, explain, 5 words, 3 help phrases, linked set", () => {
    expect(checkCard(card("p2-a"), set("p3-a"))).toEqual([]);
    const bad = { ...card("p2-a"), prompt: "Talk about a place.", bullets: ["one"], explain: "why", useful_words: [], help: [] };
    const problems = checkCard(bad, undefined);
    expect(problems).toEqual(
      expect.arrayContaining([
        'prompt must start with "Describe"',
        "needs exactly 3 bullets",
        'explain line must start with "and explain"',
        "needs 5 useful words with Spanish glosses",
        "needs 3 help phrases",
        "linked Part 3 set p3-a is missing",
      ]),
    );
  });

  it("checks Part 3 mix and health tagging", () => {
    const s = set("p3-a");
    s.questions = s.questions.map((q) => ({ ...q, kind: "abstract" as const }));
    expect(checkCard(card("p2-a"), s).join("\n")).toMatch(/at least 2 concrete/);
    const h = { ...card("p2-h", "evergreen", "Basic Care and Comfort"), nclex_area: "none" as const };
    expect(checkCard(h, set("p3-h"))).toContain("health card without an NCLEX area");
  });

  it("checks Part 1 topics", () => {
    expect(checkPart1Topic(topic("p1-a"))).toEqual([]);
    expect(checkPart1Topic({ ...topic("p1-a"), questions: ["Hi"] })).toContain("needs 3 to 5 questions");
  });

  it("finds duplicate ids across files", () => {
    const [ever, season] = fullBank();
    season!.part1.push(topic("p1-work"));
    expect(validateBank([ever!, season!], SEP).errors.join("\n")).toMatch(/duplicate id p1-work/);
  });
});
