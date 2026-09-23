// IELTS Speaking (SPEC 7): scripted examiner lines and the step list the
// engine runs. Lines follow the neutral, formulaic style of the real test.

import { LEVELS, type LevelId } from "../levels/levels";
import { orderPart3 } from "../session/part3";
import type { AnswerRules, CueCard, DiscussionRules, EndpointingDefaults, MonologueRules, Part3Set, Step } from "./types";

export interface Part1Topic {
  id: string;
  topic: string;
  /** Opening topics (Work, Home, Hometown) come first. */
  opening: boolean;
  /** Spoken before the first question; defaults to "Now let's talk about <topic>." */
  intro?: string;
  questions: string[];
}

export interface IeltsItems {
  part1: Part1Topic[];
  part2: CueCard;
  /** The Part 3 set linked to the Part 2 card. */
  part3?: Part3Set;
}

export const IELTS_ENDPOINTING: EndpointingDefaults = {
  noSpeechMs: 8_000,
  continuationExtraMs: 1_500,
  shortAnswerWords: 6,
};

export const PART1_RULES: AnswerRules = { baseSilenceMs: 2_500, maxAnswerMs: 40_000 };
export const OPENING_RULES: AnswerRules = { baseSilenceMs: 2_500, maxAnswerMs: null };
export const ROUNDOFF_RULES: AnswerRules = { baseSilenceMs: 2_500, maxAnswerMs: 40_000 };
/** Part 3 and Clinical (used from step 3). */
export const PART3_RULES: AnswerRules = { baseSilenceMs: 3_500, maxAnswerMs: null };

export const PART3_DISCUSSION: DiscussionRules = {
  answer: PART3_RULES,
  endAfterMs: 270_000,
  minQuestions: 4,
  lengthMs: 300_000,
  endAllowedUnderMs: 45_000,
};

export const PART2_HARD_STOP_MS = 120_000;
export const PART2_BACKUP_SILENCE_MS = 4_000;
export const PART2_END_SILENCE_MS = 6_000;

export function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function prepPhrase(ms: number): string {
  if (ms === 60_000) return "one minute";
  if (ms === 90_000) return "one and a half minutes";
  if (ms === 120_000) return "two minutes";
  return `${Math.round(ms / 1000)} seconds`;
}

export const LINES = {
  opening: (hour: number, name: string) => `${greeting(hour)}. My name is ${name}. Can you tell me your full name, please?`,
  openingRepeat: "Can you tell me your full name, please?",
  id: "Thank you. And can I see your identification, please?",
  idRepeat: "Can I see your identification, please?",
  part1Intro: "Thank you, that's fine. Now, in this first part, I'd like to ask you some questions about yourself.",
  part2Intro: (prepMs: number) =>
    `Now I'm going to give you a topic, and I'd like you to talk about it for one to two minutes. Before you talk, you'll have ${prepPhrase(prepMs)} to think about what you're going to say. You can make some notes if you wish. Here is your topic.`,
  part2Start:
    "All right. Remember, you have one to two minutes for this, so don't worry if I stop you. I'll tell you when the time is up. Please start speaking now.",
  part2StartRepeat: "Please start speaking now.",
  backup: (bullet: string) => `Can you tell me any more about ${bullet}?`,
  /** Examiner interruption (Part 1 time limit, Part 2 hard stop) and neutral transition. */
  thankYou: "Thank you.",
  closing: "Thank you. That is the end of the speaking test.",
  resume: "Let's continue.",
  /** Printed on the cue card. */
  cueCardLead: "You should say:",
  part3Link: (topic: string) =>
    `We've been talking about ${topic}, and I'd like to discuss with you one or two more general questions related to this.`,
};

/** "Describe a noisy place you have been to." -> "a noisy place you have been to" */
export function cardTopic(prompt: string): string {
  return prompt
    .replace(/^describe\s+/i, "")
    .replace(/[.?!]\s*$/, "")
    .trim();
}

export function topicIntro(t: Part1Topic): string {
  return t.intro ?? `Now let's talk about ${t.topic.toLowerCase()}.`;
}

export interface ScriptOptions {
  examinerName: string;
  level: LevelId;
  /** Local hour, for the greeting. */
  hour: number;
}

/** Compiles the selected items into the steps the engine runs. */
export function buildIeltsScript(items: IeltsItems, opts: ScriptOptions): Step[] {
  const level = LEVELS[opts.level];
  const steps: Step[] = [];

  steps.push({
    kind: "ask",
    state: "opening",
    id: "opening-name",
    part: 0,
    text: LINES.opening(opts.hour, opts.examinerName),
    repeatText: LINES.openingRepeat,
    rules: OPENING_RULES,
  });
  steps.push({ kind: "ask", state: "opening", id: "opening-id", part: 0, text: LINES.id, repeatText: LINES.idRepeat, rules: OPENING_RULES });

  const topics = [...items.part1].sort((a, b) => Number(b.opening) - Number(a.opening));
  topics.forEach((topic, ti) => {
    topic.questions.forEach((q, qi) => {
      const lead = qi === 0 ? [ti === 0 ? LINES.part1Intro : "", topicIntro(topic)] : [];
      steps.push({
        kind: "ask",
        state: "part1",
        id: `${topic.id}-q${qi + 1}`,
        part: 1,
        text: [...lead, q].filter(Boolean).join(" "),
        repeatText: q,
        rules: PART1_RULES,
      });
    });
  });

  const card = items.part2;
  const rules: MonologueRules = {
    hardStopMs: PART2_HARD_STOP_MS,
    goalMs: level.part2GoalMs,
    backupSilenceMs: PART2_BACKUP_SILENCE_MS,
    endSilenceMs: PART2_END_SILENCE_MS,
  };
  steps.push({ kind: "say", state: "part2_prep", text: LINES.part2Intro(level.part2PrepMs) });
  steps.push({ kind: "prep", state: "part2_prep", card, ms: level.part2PrepMs });
  steps.push({ kind: "monologue", state: "part2_speak", id: card.id, card, text: LINES.part2Start, repeatText: LINES.part2StartRepeat, rules });

  const roundoff = card.roundoff[0];
  if (roundoff) {
    steps.push({ kind: "ask", state: "part2_roundoff", id: `${card.id}-roundoff`, part: 2, text: roundoff, repeatText: roundoff, rules: ROUNDOFF_RULES });
  }

  if (items.part3 && items.part3.questions.length > 0) {
    steps.push({
      kind: "discussion",
      state: "part3",
      id: items.part3.id,
      set: { ...items.part3, questions: orderPart3(items.part3.questions, level.part3Order) },
      part2Prompt: card.prompt,
      link: LINES.part3Link(cardTopic(card.prompt)),
      rules: PART3_DISCUSSION,
    });
  }

  steps.push({ kind: "say", state: "closing", text: LINES.closing, interruptible: false });
  return steps;
}
