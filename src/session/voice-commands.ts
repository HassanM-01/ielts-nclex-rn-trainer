// Voice commands (SPEC 8): a repeat request is an utterance of 6 words or
// fewer whose WHOLE text asks for a repeat. "Sorry, I don't really like
// shoes" is an answer, not a request.

import { normalizeWords } from "../speech/text";

export const MAX_COMMAND_WORDS = 6;

const OPENERS = "(?:(?:um|uh|oh|er) )?(?:(?:i'm sorry|sorry|pardon|pardon me|excuse me|i beg your pardon) )?";
const PLEASE = "(?: please)?";

const REQUESTS = [
  // "sorry", "pardon", "pardon me", "excuse me", "i'm sorry", "sorry what"
  "(?:i'm sorry|sorry|pardon|pardon me|excuse me|i beg your pardon)(?: what)?",
  "what",
  "come again",
  "one more time",
  // "can you repeat that", "could you say that again please", "would you repeat the question"
  "(?:can|could|would) you(?: please)? (?:repeat|say)(?: that| it| the question)?(?: again)?(?: one more time)?",
  "(?:please )?repeat(?: that| it| the question)?(?: again)?",
  "say (?:that|it) again",
  "what do you mean",
  "what (?:was|is) the question",
  "i didn't (?:catch|understand|hear|get)(?: that| it| you| the question)?",
  "i don't understand(?: the question)?",
];

const PATTERN = new RegExp(`^${OPENERS}(?:${REQUESTS.join("|")})${PLEASE}$`);

export function isRepeatRequest(text: string): boolean {
  const words = normalizeWords(text);
  if (words.length === 0 || words.length > MAX_COMMAND_WORDS) return false;
  return PATTERN.test(words.join(" "));
}
