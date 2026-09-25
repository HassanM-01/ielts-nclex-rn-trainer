// Loads the IELTS bank from data/bank/ielts/*.json once per function
// instance (vercel.json includes data/bank). Missing or broken files are
// skipped: session-start then returns no items and the browser uses its
// fixed set.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BankFile } from "../../src/exams/bank";

let cached: BankFile[] | null = null;

function isBankFile(x: unknown): x is BankFile {
  if (!x || typeof x !== "object") return false;
  const f = x as Partial<BankFile>;
  return typeof f.season === "string" && Array.isArray(f.part1) && Array.isArray(f.part2) && Array.isArray(f.part3);
}

export function loadBank(dir = join(process.cwd(), "data", "bank", "ielts")): BankFile[] {
  if (cached) return cached;
  const files: BankFile[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json"));
  } catch {
    names = [];
  }
  for (const name of names) {
    try {
      const data: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (isBankFile(data)) files.push(data);
    } catch {
      // A broken file is skipped; bank:validate reports it.
    }
  }
  cached = files;
  return files;
}

/** Tests only. */
export function resetBankCache(): void {
  cached = null;
}
