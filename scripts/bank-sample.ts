// npm run bank:sample — prints random cards (with their Part 3 sets) and
// Part 1 topics in a readable form, for reviewing the bank (HUMAN_GUIDE 4c).
//
// Options: --cards=N (default 8), --topics=N (default 5), --id=p2-...,p1-...

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BankFile } from "../src/exams/bank";

const BANK_DIR = join(process.cwd(), "data", "bank", "ielts");
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

const files: BankFile[] = (existsSync(BANK_DIR) ? readdirSync(BANK_DIR) : [])
  .filter((n) => n.endsWith(".json"))
  .map((n) => JSON.parse(readFileSync(join(BANK_DIR, n), "utf8")) as BankFile);

const shuffle = <T>(list: T[]): T[] => list.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
const ids = (arg("id") ?? "").split(",").filter(Boolean);
const cards = files.flatMap((f) => f.part2.map((c) => ({ c, f })));
const topics = files.flatMap((f) => f.part1.map((t) => ({ t, f })));
const pickCards = ids.length ? cards.filter(({ c }) => ids.includes(c.id)) : shuffle(cards).slice(0, Number(arg("cards") ?? 8));
const pickTopics = ids.length ? topics.filter(({ t }) => ids.includes(t.id)) : shuffle(topics).slice(0, Number(arg("topics") ?? 5));

const out: string[] = [];
for (const { c, f } of pickCards) {
  const set = f.part3.find((s) => s.id === c.part3_id);
  out.push(`## ${c.id}  (${f.season}${c.nclex_area !== "none" ? `, health: ${c.nclex_area}` : ""})`, "");
  out.push(c.prompt, "You should say:", ...c.bullets.map((b) => `  - ${b}`), c.explain, "");
  out.push(`Round-off: ${c.roundoff.join(" / ")}`);
  out.push(`Useful words: ${c.useful_words.map((w) => `${w.en} (${w.es})`).join("; ")}`);
  out.push("Help:", ...c.help.map((h) => `  - ${h.en} — ${h.es}`), "");
  if (set) {
    out.push(`Part 3: ${set.theme}`);
    for (const q of set.questions) {
      out.push(`  [${q.kind}] ${q.q}`, `      rephrase: ${q.rephrase}`, `      follow-ups: ${q.followups.join(" / ")}`);
      out.push(`      help: ${(q.help ?? []).map((h) => `${h.en} — ${h.es}`).join(" | ")}`);
    }
  }
  out.push("", "---", "");
}
for (const { t, f } of pickTopics) {
  out.push(`## ${t.id}  (Part 1, ${f.season}${t.opening ? ", opening" : ""})`, t.intro ?? "", ...t.questions.map((q) => `  - ${q}`), "");
}
console.log(out.join("\n"));
