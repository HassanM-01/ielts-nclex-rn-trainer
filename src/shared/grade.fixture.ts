// A schema-valid grade for tests.

import type { Grade } from "./grade";

export const SAMPLE_GRADE: Grade = {
  fluency_coherence: { evidence: ["and then I go to the hospital"], band: 6, advice_es: "Usa conectores como «however»." },
  lexical_resource: { evidence: ["patients", "shift"], band: 6, advice_es: "Evita repetir «good»." },
  grammatical_range: { evidence: ["I go to hospital yesterday"], band: 5, advice_es: "Revisa el pasado simple." },
  pronunciation_proxy: { flagged: [{ heard: "sheet", likely: "shift" }], note_es: "Cuida la «f» final." },
  top_fixes_es: ["Uno", "Dos", "Tres"],
  next_focus_es: "Pasado simple.",
  upgraded_answers: [{ part: 1, question: "Do you work?", original: "yes I work nurse", better: "Yes, I work as a nurse.", why_es: "Artículo." }],
  saved_words_used: [],
  vocab_to_learn: [{ word: "triage", es: "clasificación", example: "Triage decides who is seen first.", exam: "both", nclex_area: "Management of Care" }],
};
