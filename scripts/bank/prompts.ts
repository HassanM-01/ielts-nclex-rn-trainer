// Prompts and output schemas for bank:build. Only topic titles come from
// outside sources; everything below is written fresh, in IELTS style
// (SPEC 9). Structured outputs guarantee the JSON shape; checkPart1Topic /
// checkCard enforce the counts the schema language can't express.

import { z } from "zod/v4";
import type { BankCard, BankPart1Topic } from "../../src/exams/bank";
import type { Part3Set } from "../../src/exams/types";
import { part3IdFor, type SeedItem } from "./seeds";

const Gloss = z.object({ en: z.string(), es: z.string() });

export const Part1Output = z.object({
  intro: z.string(),
  questions: z.array(z.string()),
});

export const CardOutput = z.object({
  prompt: z.string(),
  bullets: z.array(z.string()),
  explain: z.string(),
  roundoff: z.array(z.string()),
  useful_words: z.array(Gloss),
  help: z.array(Gloss),
  part3: z.object({
    theme: z.string(),
    questions: z.array(
      z.object({
        q: z.string(),
        kind: z.enum(["concrete", "abstract"]),
        rephrase: z.string(),
        followups: z.array(z.string()),
        help: z.array(Gloss),
      }),
    ),
  }),
});

export type Part1Out = z.infer<typeof Part1Output>;
export type CardOut = z.infer<typeof CardOutput>;

export const SYSTEM = `You write practice material for the IELTS Academic Speaking test, used by an adult Mexican nurse preparing for band 7.0. The material must read exactly like the real test: the neutral, formulaic wording of the official examiner frame, natural British or international English, no slang, nothing culturally narrow.

Never copy sample answers or passages from IELTS preparation websites or books. Write every question and phrase yourself.

Spanish text is Mexican Spanish with correct accents and punctuation (¿?, ¡!). Glosses are short and natural, the way a Mexican teacher would translate the word or phrase in context.`;

export function part1Prompt(seed: Extract<SeedItem, { kind: "part1" }>): string {
  const opening = seed.opening
    ? `This is an OPENING topic: it is always asked first, straight after the ID check. Start with the standard opener the real test uses for it (Work: "Do you work or are you a student?"; Home and accommodation: "Do you live in a house or an apartment?"; Hometown: "Where is your hometown?"). The intro should be short, like "Let's talk about what you do." or "Let's talk about where you live."`
    : `The intro is one short sentence the examiner says before the first question, like "Now let's talk about ${seed.title.toLowerCase()}."`;
  return `Write one IELTS Speaking Part 1 topic.

Topic: ${seed.title}

${opening}

Write exactly 4 questions, in the order an examiner would ask them. Part 1 questions are short (usually 5 to 12 words) and about the candidate's own life: habits, preferences, likes and dislikes, frequency, the past ("when you were a child"), and one gently hypothetical or future question at most. Vary the forms: "Do you ...?", "How often ...?", "What kind of ...?", "Why ...?", "Did you ... when you were younger?", "Would you like to ...?". No two questions may ask the same thing. No abstract or society-level questions (those belong to Part 3).`;
}

export function cardPrompt(seed: Extract<SeedItem, { kind: "part2" }>): string {
  const health = seed.health
    ? `
This is a HEALTH card, tagged with the NCLEX-RN Client Needs area "${seed.area}". It must still be an ordinary IELTS cue card that any candidate could answer from everyday life, but one a nurse can answer richly from work, using the kind of language that area involves. The Part 3 questions stay general and abstract (society, prevention versus treatment, why people ignore health advice, the future of care), as in the real test, never clinical exam questions.`
    : "";
  return `Write one IELTS Speaking Part 2 cue card with its linked Part 3 discussion.

Card topic: ${seed.title}
${health}
Cue card:
- prompt: one sentence starting "Describe", ending with a full stop (e.g. "Describe a noisy place you have been to.").
- bullets: exactly 3 short lowercase fragments that follow "You should say:" (e.g. "where it was", "when you went there", "what made it noisy").
- explain: one line starting "and explain" and ending with a full stop (e.g. "and explain how you felt about the noise.").
- roundoff: exactly 2 short, simple questions the examiner may ask after the long turn, closely linked to the card (e.g. "Do you usually prefer quiet places or busy ones?").
- useful_words: exactly 5 words or short collocations at B2–C1 level that help talk about this card, each with a Spanish gloss.
- help: exactly 3 phrases a strong candidate would actually say in this long turn (openers, linkers, ways to add detail), each with a Spanish translation.

Part 3 (the two-way discussion that follows):
- theme: 2 to 5 words naming the broader theme (e.g. "Noise and cities").
- questions: exactly 5, broader than the card and not personal repeats of it, in the order an examiner would ask them (concrete first, then abstract):
  - at least 2 "concrete": about people's experience in the candidate's country or city ("Do people in your country ...?", "What kinds of ... are popular where you live?").
  - at least 2 "abstract": causes, comparisons, advantages and disadvantages, society, the future ("Why do some people ...?", "How might ... change in the future?", "Should governments ...?").
  - each 8 to 22 words, neutral examiner style, one question only.
  - rephrase: the same question in simpler words (said if the candidate asks for a repeat); same meaning, easier vocabulary.
  - followups: exactly 2 short follow-up questions that push for a reason, an example or a comparison (e.g. "Why do you think that is?", "Can you give me an example from your city?").
  - help: exactly 3 phrases a strong candidate could use to start or develop an answer to that question, each with a Spanish translation.`;
}

export function toPart1Topic(seed: Extract<SeedItem, { kind: "part1" }>, out: Part1Out, tag: string): BankPart1Topic {
  return {
    id: seed.id,
    topic: seed.title,
    opening: seed.opening,
    intro: out.intro.trim(),
    questions: out.questions.map((q) => q.trim()),
    tags: [tag],
  };
}

export function toCard(seed: Extract<SeedItem, { kind: "part2" }>, out: CardOut, tag: string): { card: BankCard; set: Part3Set } {
  const part3Id = part3IdFor(seed.id);
  const card: BankCard = {
    id: seed.id,
    prompt: out.prompt.trim(),
    bullets: out.bullets.map((b) => b.trim()),
    explain: out.explain.trim(),
    roundoff: out.roundoff.map((q) => q.trim()),
    tags: seed.health ? [tag, "health"] : [tag],
    nclex_area: seed.area,
    part3_id: part3Id,
    useful_words: out.useful_words,
    help: out.help,
  };
  const set: Part3Set = {
    id: part3Id,
    theme: out.part3.theme.trim(),
    questions: out.part3.questions.map((q) => ({
      q: q.q.trim(),
      kind: q.kind,
      rephrase: q.rephrase.trim(),
      followups: q.followups.map((f) => f.trim()),
      help: q.help,
    })),
  };
  return { card, set };
}
