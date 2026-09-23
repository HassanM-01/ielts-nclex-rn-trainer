// Part 2 cue card. Exam content, so English, laid out like the real card.

import { LINES } from "../exams/ielts";
import type { CueCard } from "../exams/types";

export function CueCardView({ card }: { card: CueCard }) {
  return (
    <div className="rounded-lg border-2 border-slate-800 bg-white p-4" lang="en">
      <p className="mb-2 text-lg font-semibold">{card.prompt}</p>
      <p className="mb-1">{LINES.cueCardLead}</p>
      <ul className="mb-2 ml-6 list-disc">
        {card.bullets.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <p>{card.explain}</p>
    </div>
  );
}
