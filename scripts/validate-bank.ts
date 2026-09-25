// npm run bank:validate — schema, counts, links and distribution (SPEC 16).
// Exits with 1 if anything required is missing.
//
// Options: --date=YYYY-MM-DD  validate as of that date (default: today)

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BankFile } from "../src/exams/bank";
import { isBuilt } from "./bank/plan";
import { parseSeeds } from "./bank/seeds";
import { validateBank } from "./bank/validate";

const BANK_DIR = join(process.cwd(), "data", "bank", "ielts");
const SEEDS_DIR = join(BANK_DIR, "seeds");

const dateArg = process.argv.find((a) => a.startsWith("--date="))?.slice(7);
const now = dateArg ? new Date(`${dateArg}T12:00:00Z`) : new Date();

const errors: string[] = [];
const files: BankFile[] = [];
for (const name of existsSync(BANK_DIR) ? readdirSync(BANK_DIR).filter((n) => n.endsWith(".json")) : []) {
  try {
    files.push(JSON.parse(readFileSync(join(BANK_DIR, name), "utf8")) as BankFile);
  } catch (err) {
    errors.push(`${name}: not valid JSON (${err instanceof Error ? err.message : String(err)})`);
  }
}

const report = validateBank(files, now);
errors.push(...report.errors);

// Every seed title should be in the bank.
const missing: string[] = [];
for (const name of existsSync(SEEDS_DIR) ? readdirSync(SEEDS_DIR).filter((n) => n.endsWith(".txt")) : []) {
  const seeds = parseSeeds(readFileSync(join(SEEDS_DIR, name), "utf8"), name);
  const file = files.find((f) => f.season === seeds.season);
  for (const s of seeds.items) if (!isBuilt(file, s)) missing.push(s.id);
}
if (missing.length) report.warnings.push(`${missing.length} seed titles not built yet (npm run bank:build): ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", …" : ""}`);

const s = report.stats;
console.log(`Bank as of ${now.toISOString().slice(0, 10)} (current season: ${s.currentSeason ?? "none"})`);
console.log(`  Part 1 topics:  ${s.part1Topics} (${s.openingTopics} opening)`);
console.log(`  Part 2 cards:   ${s.part2Cards} (${s.seasonCards} current season, ${s.healthCards} health)`);
console.log(`  Part 3 sets:    ${s.part3Sets}`);
console.log(`  Health by NCLEX area: ${Object.entries(s.healthByArea).map(([a, n]) => `${a} ${n}`).join("; ") || "none"}`);
for (const w of report.warnings) console.log(`  warning: ${w}`);
if (errors.length) {
  console.log(`\n${errors.length} problem(s):`);
  for (const e of errors.slice(0, 50)) console.log(`  ✗ ${e}`);
  if (errors.length > 50) console.log(`  … and ${errors.length - 50} more`);
  process.exitCode = 1;
} else {
  console.log("\n✓ The bank passes validation.");
}
