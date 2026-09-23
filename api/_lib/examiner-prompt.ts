// Validates /api/examiner input and builds the (small) prompt: only the Part 2
// topic, the Part 3 questions and the Part 3 exchange so far (SPEC 3.6).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExaminerRequest, ExaminerTurnRequest, FollowupAllowance } from "../../src/shared/examiner-api";

const LIMITS = { questions: 12, questionChars: 400, exchange: 40, entryChars: 4_000, promptChars: 400 };
const ALLOWANCES: FollowupAllowance[] = ["1-per-part", "1-per-2-questions", "1-per-question"];

let systemPrompt: string | null = null;

/** Loaded once per function instance (vercel.json includes api/prompts). */
export function examinerSystemPrompt(): string {
  systemPrompt ??= readFileSync(join(process.cwd(), "api", "prompts", "examiner.md"), "utf8").trim();
  return systemPrompt;
}

function isString(x: unknown, max: number): x is string {
  return typeof x === "string" && x.length > 0 && x.length <= max;
}

export function parseExaminerRequest(body: unknown): ExaminerRequest | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.kind === "ping") return { kind: "ping" };
  if (b.kind !== "turn") return null;
  const { part2Prompt, questions, index, exchange, secondsLeft, followupsUsed, allowance } = b;
  if (!isString(part2Prompt, LIMITS.promptChars)) return null;
  if (!Array.isArray(questions) || questions.length === 0 || questions.length > LIMITS.questions) return null;
  if (!questions.every((q) => isString(q, LIMITS.questionChars))) return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= questions.length) return null;
  if (!Array.isArray(exchange) || exchange.length === 0 || exchange.length > LIMITS.exchange) return null;
  for (const e of exchange) {
    if (!e || typeof e !== "object") return null;
    const { role, text } = e as Record<string, unknown>;
    if ((role !== "examiner" && role !== "candidate") || typeof text !== "string" || text.length > LIMITS.entryChars) return null;
  }
  if (typeof secondsLeft !== "number" || !Number.isFinite(secondsLeft)) return null;
  if (typeof followupsUsed !== "number" || !Number.isInteger(followupsUsed) || followupsUsed < 0) return null;
  if (typeof allowance !== "string" || !ALLOWANCES.includes(allowance as FollowupAllowance)) return null;
  return {
    kind: "turn",
    part2Prompt,
    questions: questions as string[],
    index,
    exchange: exchange as ExaminerTurnRequest["exchange"],
    secondsLeft,
    followupsUsed,
    allowance: allowance as FollowupAllowance,
  };
}

const ALLOWANCE_TEXT: Record<FollowupAllowance, string> = {
  "1-per-part": "at most one follow-up in the whole of Part 3",
  "1-per-2-questions": "at most one follow-up for every two listed questions",
  "1-per-question": "at most one follow-up per listed question",
};

/** The user message for one examiner decision. */
export function buildExaminerMessage(r: ExaminerTurnRequest): string {
  const questions = r.questions.map((q, i) => `${i + 1}. ${q}${i === r.index ? "   <- just answered" : ""}`).join("\n");
  const convo = r.exchange.map((e) => `${e.role === "examiner" ? "Examiner" : "Candidate"}: ${e.text || "(no answer)"}`).join("\n");
  const secs = Math.max(0, Math.round(r.secondsLeft));
  return [
    `Part 2 topic: ${r.part2Prompt}`,
    "",
    "Listed Part 3 questions:",
    questions,
    "",
    "Part 3 so far:",
    convo,
    "",
    `Time left in Part 3: ${secs} seconds${secs < 45 ? " ([END] is allowed)" : " ([END] is not allowed)"}`,
    `Follow-ups: ${r.followupsUsed} used; the rule for this candidate's level is ${ALLOWANCE_TEXT[r.allowance]}. A follow-up is allowed now.`,
  ].join("\n");
}
