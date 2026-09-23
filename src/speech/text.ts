// Small text helpers shared by the speech layer. Pure, no DOM.

/** Lowercase words with punctuation removed (apostrophes kept: "don't"). */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length > 0);
}

export function countWords(text: string): number {
  return normalizeWords(text).length;
}

// Abbreviations whose trailing period does not end a sentence.
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "prof", "st", "vs", "etc", "e.g", "i.e", "u.s", "u.k", "a.m", "p.m", "no"]);

/**
 * Split examiner text into sentences, one utterance each (SPEC 6: one
 * utterance per sentence). Keeps the terminal punctuation on each sentence.
 */
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch !== "." && ch !== "?" && ch !== "!") continue;
    // Absorb runs like "?!" or "..." and closing quotes.
    let end = i + 1;
    while (end < clean.length && /[.?!"')\]]/.test(clean[end] ?? "")) end++;
    const next = clean[end];
    if (next !== undefined && next !== " ") continue; // e.g. "3.5" or "e.g."
    if (ch === ".") {
      const before = clean.slice(start, i);
      const lastWord = (before.split(" ").pop() ?? "").toLowerCase();
      if (ABBREVIATIONS.has(lastWord)) continue;
    }
    const sentence = clean.slice(start, end).trim();
    if (sentence) out.push(sentence);
    start = end;
    i = end - 1;
  }
  const rest = clean.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}
