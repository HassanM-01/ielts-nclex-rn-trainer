// What bank:build still has to generate, and what it will roughly cost.
// A re-run only builds what's missing, so a failure never wastes work.

import type { BankFile } from "../../src/exams/bank";
import { part3IdFor, type SeedFile, type SeedItem } from "./seeds";

export interface BuildTask {
  output: string;
  seed: SeedItem;
}

export function emptyBankFile(seeds: SeedFile): BankFile {
  return { season: seeds.season, ends: seeds.ends, part1: [], part2: [], part3: [] };
}

export function isBuilt(file: BankFile | undefined, seed: SeedItem): boolean {
  if (!file) return false;
  if (seed.kind === "part1") return file.part1.some((t) => t.id === seed.id);
  return file.part2.some((c) => c.id === seed.id) && file.part3.some((s) => s.id === part3IdFor(seed.id));
}

export function planBuild(seedFiles: readonly SeedFile[], existing: ReadonlyMap<string, BankFile>, only: readonly string[] = []): BuildTask[] {
  const tasks: BuildTask[] = [];
  for (const sf of seedFiles) {
    for (const seed of sf.items) {
      if (only.length > 0 ? only.includes(seed.id) : !isBuilt(existing.get(sf.output), seed)) {
        tasks.push({ output: sf.output, seed });
      }
    }
  }
  return tasks;
}

/** USD per million tokens. Thinking tokens are billed as output. */
export const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

/** Rough per-item token use (system prompt + seed in; JSON + thinking out). */
export const ASSUMED_TOKENS = {
  part1: { input: 1_300, output: 1_500 },
  part2: { input: 2_000, output: 6_000 },
} as const;

export interface Estimate {
  items: { part1: number; part2: number };
  inputTokens: number;
  outputTokens: number;
  usd: number | null;
}

export function estimateCost(tasks: readonly BuildTask[], model: string): Estimate {
  const part1 = tasks.filter((t) => t.seed.kind === "part1").length;
  const part2 = tasks.length - part1;
  const inputTokens = part1 * ASSUMED_TOKENS.part1.input + part2 * ASSUMED_TOKENS.part2.input;
  const outputTokens = part1 * ASSUMED_TOKENS.part1.output + part2 * ASSUMED_TOKENS.part2.output;
  const price = PRICING[model];
  const usd = price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : null;
  return { items: { part1, part2 }, inputTokens, outputTokens, usd };
}

export function usageCost(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = PRICING[model];
  return price ? (inputTokens * price.input + outputTokens * price.output) / 1_000_000 : null;
}
