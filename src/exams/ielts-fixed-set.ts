// Hand-written practice set for steps 2 and 3, until the seasonal bank and
// /api/session-start arrive in step 4. Written in IELTS style; the Part 2
// card is the SPEC 9 example.

import type { IeltsItems } from "./ielts";

export const FIXED_SET: IeltsItems = {
  part1: [
    {
      id: "p1-work",
      topic: "Work",
      opening: true,
      intro: "Let's talk about what you do.",
      questions: [
        "Do you work or are you a student?",
        "What do you like most about your job?",
        "Why did you choose this kind of work?",
        "Would you like to change your job in the future?",
      ],
    },
    {
      id: "p1-shoes",
      topic: "Shoes",
      opening: false,
      questions: [
        "Do you like buying shoes?",
        "How often do you buy new shoes?",
        "Have you ever bought shoes online?",
        "Do you prefer comfortable shoes or fashionable ones?",
      ],
    },
    {
      id: "p1-computers",
      topic: "Computers",
      opening: false,
      questions: [
        "How often do you use a computer?",
        "What do you usually use a computer for?",
        "When did you first learn to use a computer?",
        "Do you think computers will become more important in the future?",
      ],
    },
  ],
  part2: {
    id: "p2-noisy-place",
    prompt: "Describe a noisy place you have been to.",
    bullets: ["where it was", "when you went there", "what made it noisy"],
    explain: "and explain how you felt about the noise.",
    roundoff: ["Do you usually prefer quiet places or busy ones?", "Is it noisy where you live?"],
  },
};
