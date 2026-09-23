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
  part3: {
    id: "p3-noise",
    theme: "Noise and cities",
    questions: [
      {
        q: "What are the noisiest places in your town or city?",
        kind: "concrete",
        rephrase: "Which places in your city are the loudest?",
        followups: ["Why are they so noisy?", "Does that bother the people who live nearby?"],
      },
      {
        q: "Do people in your country complain much about noise from their neighbours?",
        kind: "concrete",
        rephrase: "Is noise from neighbours a common problem where you live?",
        followups: ["Why do you think that is?", "How do people usually deal with it?"],
      },
      {
        q: "Why do you think some people enjoy noisy places, while others prefer quiet ones?",
        kind: "abstract",
        rephrase: "Why do people have such different feelings about noisy places?",
        followups: ["Can you give me an example?", "Do you think age makes a difference?"],
      },
      {
        q: "How does noise in cities affect people's health and well-being?",
        kind: "abstract",
        rephrase: "In what ways can city noise be bad for people?",
        followups: ["Which effect do you think is the most serious?", "Why is that?"],
      },
      {
        q: "Should governments do more to control noise in public places?",
        kind: "abstract",
        rephrase: "Do you think the government should do more to make cities quieter?",
        followups: ["What could they do?", "Would people accept rules like that?"],
      },
      {
        q: "Do you think cities will become noisier or quieter in the future?",
        kind: "abstract",
        rephrase: "Will cities be louder or quieter in the years to come?",
        followups: ["Why do you think so?", "What might change that?"],
      },
    ],
  },
};
