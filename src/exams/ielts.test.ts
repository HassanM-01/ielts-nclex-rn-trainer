import { describe, expect, it } from "vitest";
import { buildIeltsScript, cardTopic, greeting, LINES, PART1_RULES, PART3_DISCUSSION } from "./ielts";
import { FIXED_SET } from "./ielts-fixed-set";

const script = buildIeltsScript(FIXED_SET, { examinerName: "Sonia", level: 3, hour: 15 });

describe("buildIeltsScript", () => {
  it("opens with the greeting, the name and the ID check", () => {
    const [name, id] = script;
    expect(name?.kind === "ask" && name.text).toBe("Good afternoon. My name is Sonia. Can you tell me your full name, please?");
    expect(id?.kind === "ask" && id.text).toBe(LINES.id);
    expect(name?.state).toBe("opening");
  });

  it("asks all Part 1 questions, opening topic first, with verbatim repeats", () => {
    const part1 = script.filter((s) => s.kind === "ask" && s.state === "part1");
    expect(part1).toHaveLength(12);
    const first = part1[0];
    expect(first?.kind === "ask" && first.text).toBe(
      `${LINES.part1Intro} Let's talk about what you do. Do you work or are you a student?`,
    );
    expect(first?.kind === "ask" && first.repeatText).toBe("Do you work or are you a student?");
    expect(first?.kind === "ask" && first.rules).toEqual(PART1_RULES);
    const shoes = part1[4];
    expect(shoes?.kind === "ask" && shoes.text).toBe("Now let's talk about shoes. Do you like buying shoes?");
  });

  it("runs Part 2 as instructions, prep, long turn, round-off, then Part 3", () => {
    const kinds = script.slice(14).map((s) => `${s.kind}:${s.state}`);
    expect(kinds).toEqual(["say:part2_prep", "prep:part2_prep", "monologue:part2_speak", "ask:part2_roundoff", "discussion:part3", "say:closing"]);
    const prep = script[15];
    expect(prep?.kind === "prep" && prep.ms).toBe(60_000);
    const mono = script[16];
    expect(mono?.kind === "monologue" && mono.rules).toEqual({ hardStopMs: 120_000, goalMs: 120_000, backupSilenceMs: 4_000, endSilenceMs: 6_000 });
  });

  it("links Part 3 to the card with the scripted sentence", () => {
    const d = script.find((s) => s.kind === "discussion");
    expect(d?.kind === "discussion" && d.link).toBe(
      "We've been talking about a noisy place you have been to, and I'd like to discuss with you one or two more general questions related to this.",
    );
    expect(d?.kind === "discussion" && d.rules).toEqual(PART3_DISCUSSION);
    expect(d?.kind === "discussion" && d.set.questions.map((q) => q.kind)).toEqual(["concrete", "concrete", "abstract", "abstract", "abstract", "abstract"]);
  });

  it("orders Part 3 by level", () => {
    const l1 = buildIeltsScript(FIXED_SET, { examinerName: "Sonia", level: 1, hour: 9 });
    const d = l1.find((s) => s.kind === "discussion");
    expect(d?.kind === "discussion" && d.set.questions.map((q) => q.kind)).toEqual(["concrete", "concrete", "abstract"]);
  });

  it("skips Part 3 when the items have no set", () => {
    const noP3 = buildIeltsScript({ ...FIXED_SET, part3: undefined }, { examinerName: "Sonia", level: 3, hour: 9 });
    expect(noP3.some((s) => s.kind === "discussion")).toBe(false);
  });

  it("uses the level's prep time and speaking goal", () => {
    const l1 = buildIeltsScript(FIXED_SET, { examinerName: "Sonia", level: 1, hour: 9 });
    const intro = l1.find((s) => s.kind === "say" && s.state === "part2_prep");
    expect(intro?.kind === "say" && intro.text).toContain("you'll have two minutes to think");
    const mono = l1.find((s) => s.kind === "monologue");
    expect(mono?.kind === "monologue" && mono.rules.goalMs).toBe(60_000);
  });

  it("ends with the closing line, which can't be interrupted", () => {
    const last = script[script.length - 1];
    expect(last).toEqual({ kind: "say", state: "closing", text: LINES.closing, interruptible: false });
  });

  it("has unique step ids", () => {
    const ids = script.flatMap((s) => (s.kind === "ask" || s.kind === "monologue" ? [s.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("practice modes", () => {
  const kinds = (mode: "part1" | "parts23") =>
    buildIeltsScript(FIXED_SET, { examinerName: "Sonia", level: 2, hour: 15, mode }).map((s) => `${s.kind}:${s.state}`);

  it("Solo Parte 1: opening, Part 1, practice closing", () => {
    const k = kinds("part1");
    expect(k.slice(0, 2)).toEqual(["ask:opening", "ask:opening"]);
    expect(k.filter((x) => x.endsWith(":part1"))).toHaveLength(12);
    expect(k.some((x) => x.includes("part2") || x.includes("part3"))).toBe(false);
    const last = buildIeltsScript(FIXED_SET, { examinerName: "Sonia", level: 2, hour: 15, mode: "part1" }).at(-1);
    expect(last?.kind === "say" && last.text).toBe(LINES.closingPractice);
  });

  it("Partes 2 y 3: a short greeting, Part 2, Part 3, practice closing", () => {
    const script = buildIeltsScript(FIXED_SET, { examinerName: "Sonia", level: 2, hour: 15, mode: "parts23" });
    expect(script[0]).toEqual({ kind: "say", state: "opening", text: LINES.practiceParts23(15, "Sonia") });
    expect(kinds("parts23").slice(1)).toEqual([
      "say:part2_prep",
      "prep:part2_prep",
      "monologue:part2_speak",
      "ask:part2_roundoff",
      "discussion:part3",
      "say:closing",
    ]);
    const prep = script.find((s) => s.kind === "prep");
    expect(prep?.kind === "prep" && prep.ms).toBe(90_000); // Nivel 2
  });
});

describe("cardTopic", () => {
  it("turns the cue card prompt into a topic phrase", () => {
    expect(cardTopic("Describe a noisy place you have been to.")).toBe("a noisy place you have been to");
    expect(cardTopic("Describe someone older than you whom you admire.")).toBe("someone older than you whom you admire");
  });
});

describe("greeting", () => {
  it("fits the time of day", () => {
    expect(greeting(9)).toBe("Good morning");
    expect(greeting(13)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
  });
});
