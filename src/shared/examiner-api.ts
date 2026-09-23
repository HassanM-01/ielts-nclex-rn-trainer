// Contract between the browser and /api/examiner (SPEC 8, "Part 3 examiner
// call"). Types and limits only: the server imports this with `import type`
// and its own copies of the limits, so nothing here reaches the server bundle
// at runtime and nothing server-side reaches the browser.

export interface ExchangeEntry {
  role: "examiner" | "candidate";
  text: string;
}

export type FollowupAllowance = "1-per-part" | "1-per-2-questions" | "1-per-question";

export interface ExaminerTurnRequest {
  kind: "turn";
  /** The Part 2 cue card prompt. */
  part2Prompt: string;
  /** The Part 3 listed questions, in the order asked. */
  questions: string[];
  /** Index of the listed question just answered. */
  index: number;
  /** The Part 3 exchange so far, ending with Julio's answer. Never Parts 1 and 2. */
  exchange: ExchangeEntry[];
  secondsLeft: number;
  followupsUsed: number;
  allowance: FollowupAllowance;
}

/** Warms a function instance at the start of Part 2 prep. No model call. */
export interface ExaminerPingRequest {
  kind: "ping";
}

export type ExaminerRequest = ExaminerTurnRequest | ExaminerPingRequest;

/** The model's reply is streamed as plain text: "[NEXT]", "[END]" or one follow-up question. */
export const REPLY_NEXT = "[NEXT]";
export const REPLY_END = "[END]";
export const FOLLOWUP_MAX_WORDS = 25;

export interface SessionStartResponse {
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

export type ApiErrorCode = "unauthorized" | "bad-request" | "not-configured" | "upstream" | "wrong-passphrase";

export interface ApiError {
  error: ApiErrorCode;
}
