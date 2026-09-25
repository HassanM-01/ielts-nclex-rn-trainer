// npm run bank:build — expands the seed titles into the full IELTS bank with
// GRADE_MODEL (SPEC 9). Prints an estimate and asks before spending; writes
// each item as soon as it's done, so a failure never wastes completed work
// and a re-run only builds what's missing.
//
// Options:
//   --dry-run          estimate only
//   --yes              don't ask for confirmation
//   --limit=N          build only the first N missing items (for a sample)
//   --only=id1,id2     (re)build exactly these items
//   --concurrency=N    parallel requests (default 3)
//   --health           with --only: select every health card
//   --part3-only       keep existing cue cards, replace only their Part 3 sets
//                      (each new set is told which questions the others use)

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { BankFile } from "../src/exams/bank";
import { emptyBankFile, estimateCost, planBuild, usageCost, type BuildTask } from "./bank/plan";
import { avoidList, cardPrompt, CardOutput, part1Prompt, Part1Output, SYSTEM, toCard, toPart1Topic } from "./bank/prompts";
import { parseSeeds, part3IdFor, type SeedFile } from "./bank/seeds";
import { checkCard, checkPart1Topic } from "./bank/validate";

const BANK_DIR = join(process.cwd(), "data", "bank", "ielts");
const SEEDS_DIR = join(BANK_DIR, "seeds");
const MAX_ATTEMPTS = 2;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

function readSeeds(): SeedFile[] {
  return readdirSync(SEEDS_DIR)
    .filter((n) => n.endsWith(".txt"))
    .sort()
    .map((n) => parseSeeds(readFileSync(join(SEEDS_DIR, n), "utf8"), n));
}

function readBank(seeds: SeedFile[]): Map<string, BankFile> {
  const out = new Map<string, BankFile>();
  for (const sf of seeds) {
    const path = join(BANK_DIR, `${sf.output}.json`);
    out.set(sf.output, existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as BankFile) : emptyBankFile(sf));
  }
  return out;
}

/** Keeps items in seed order; writes atomically. */
function writeBankFile(sf: SeedFile, file: BankFile): void {
  const order = new Map(sf.items.map((s, i) => [s.id, i]));
  const rank = (id: string) => order.get(id) ?? Number.MAX_SAFE_INTEGER;
  file.part1.sort((a, b) => rank(a.id) - rank(b.id));
  file.part2.sort((a, b) => rank(a.id) - rank(b.id));
  file.part3.sort((a, b) => rank(a.id.replace(/^p3-/, "p2-")) - rank(b.id.replace(/^p3-/, "p2-")));
  const path = join(BANK_DIR, `${sf.output}.json`);
  writeFileSync(`${path}.tmp`, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  renameSync(`${path}.tmp`, path);
}

/** Keeps the avoid list to the health sets (the ones being made distinct) and short. */
let healthSetIds = new Set<string>();
function onlyHealthOthers(questions: string[]): string[] {
  return questions.filter((q) => healthQuestions.has(q)).slice(0, 80);
}
let healthQuestions = new Set<string>();

async function main(): Promise<void> {
  const model = process.env.GRADE_MODEL ?? "";
  if (!model || !process.env.ANTHROPIC_API_KEY) {
    console.error("GRADE_MODEL and ANTHROPIC_API_KEY must be set (npm run bank:build reads .env.local).");
    process.exit(1);
  }
  const seeds = readSeeds();
  const bank = readBank(seeds);
  const refreshHealth = () => {
    healthSetIds = new Set([...bank.values()].flatMap((f) => f.part2.filter((c) => c.tags.includes("health")).map((c) => c.part3_id)));
    healthQuestions = new Set([...bank.values()].flatMap((f) => f.part3.filter((s) => healthSetIds.has(s.id)).flatMap((s) => s.questions.map((q) => q.q))));
  };
  refreshHealth();
  const only = (arg("only") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (arg("health")) {
    for (const sf of seeds) for (const it of sf.items) if (it.kind === "part2" && it.health) only.push(it.id);
  }
  const part3Only = !!arg("part3-only");
  let tasks = planBuild(seeds, bank, only);
  const limit = Number(arg("limit") ?? 0);
  if (limit > 0) tasks = tasks.slice(0, limit);

  if (tasks.length === 0) {
    console.log("Nothing to build: every seed title is already in the bank. Run npm run bank:validate.");
    return;
  }

  const est = estimateCost(tasks, model);
  console.log(`\nModel: ${model}`);
  console.log(`To build: ${est.items.part1} Part 1 topics, ${est.items.part2} cue cards (each with a Part 3 set)`);
  console.log(`Estimated tokens: ~${Math.round(est.inputTokens / 1000)}k input, ~${Math.round(est.outputTokens / 1000)}k output (thinking included; rough)`);
  console.log(est.usd === null ? "Estimated cost: unknown price for this model" : `Estimated cost: about US$${est.usd.toFixed(2)}\n`);
  if (arg("dry-run")) return;

  if (!arg("yes")) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question('Type "yes" to build: ');
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      console.log("Cancelled. Nothing was spent.");
      return;
    }
  }

  const client = new Anthropic({ maxRetries: 4 });
  const seedFile = new Map(seeds.map((s) => [s.output, s]));
  let inputTokens = 0;
  let outputTokens = 0;
  let done = 0;
  const failed: string[] = [];

  async function build(task: BuildTask): Promise<void> {
    const file = bank.get(task.output)!;
    const tag = file.season === "evergreen" ? "evergreen" : "season";
    const seed = task.seed;
    // Questions the other cards use (for --part3-only rebuilds).
    const others = () =>
      part3Only
        ? [...bank.values()].flatMap((f) => f.part3.filter((s) => s.id !== part3IdFor(seed.id)).flatMap((s) => s.questions.map((q) => q.q)))
        : [];
    const basePrompt = () => (seed.kind === "part1" ? part1Prompt(seed) : cardPrompt(seed) + avoidList(onlyHealthOthers(others())));
    let prompt = basePrompt();
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const format = seed.kind === "part1" ? zodOutputFormat(Part1Output) : zodOutputFormat(CardOutput);
      const res = await client.messages.parse({
        model,
        max_tokens: 16_000,
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
        output_config: { format, effort: "medium" },
      });
      inputTokens += res.usage.input_tokens;
      outputTokens += res.usage.output_tokens;
      if (res.stop_reason === "refusal") throw new Error("the model declined");

      let problems: string[];
      if (res.stop_reason === "max_tokens" || !res.parsed_output) {
        problems = ["the output was incomplete"];
      } else if (seed.kind === "part1") {
        const topic = toPart1Topic(seed, res.parsed_output as ReturnType<typeof Part1Output.parse>, tag);
        problems = checkPart1Topic(topic);
        if (problems.length === 0) {
          file.part1 = [...file.part1.filter((t) => t.id !== topic.id), topic];
          writeBankFile(seedFile.get(task.output)!, file);
          return;
        }
      } else {
        const built = toCard(seed, res.parsed_output as ReturnType<typeof CardOutput.parse>, tag);
        const existingCard = file.part2.find((c) => c.id === built.card.id);
        const card = part3Only && existingCard ? existingCard : built.card;
        const set = built.set;
        problems = checkCard(card, set);
        if (problems.length === 0) {
          file.part2 = [...file.part2.filter((c) => c.id !== card.id), card];
          file.part3 = [...file.part3.filter((s) => s.id !== part3IdFor(card.id)), set];
          writeBankFile(seedFile.get(task.output)!, file);
          refreshHealth();
          return;
        }
      }
      prompt = `${basePrompt()}\n\nA previous attempt had these problems. Avoid them:\n${problems.map((p) => `- ${p}`).join("\n")}`;
    }
    throw new Error("still invalid after a retry");
  }

  const queue = [...tasks];
  const concurrency = Math.max(1, Number(arg("concurrency") ?? 3));
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let task = queue.shift(); task; task = queue.shift()) {
        try {
          await build(task);
          done++;
          console.log(`  ✓ ${task.seed.id} (${done}/${tasks.length})`);
        } catch (err) {
          failed.push(task.seed.id);
          console.log(`  ✗ ${task.seed.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }),
  );

  const cost = usageCost(model, inputTokens, outputTokens);
  console.log(`\nBuilt ${done} of ${tasks.length}. Tokens used: ${inputTokens} input, ${outputTokens} output.`);
  console.log(cost === null ? "" : `Actual cost: about US$${cost.toFixed(2)} (record it in PROGRESS.md's cost log).`);
  if (failed.length) {
    console.log(`Failed: ${failed.join(", ")}. Run npm run bank:build again to retry only those.`);
    process.exitCode = 1;
  }
  console.log("Next: npm run bank:validate");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
