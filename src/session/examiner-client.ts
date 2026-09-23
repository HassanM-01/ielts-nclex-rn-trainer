// Browser side of /api/examiner (SPEC 3 and 8). Client guard: at most one
// request in flight and at most 40 per session, so a bug can't loop API
// calls. Every failure resolves (never throws) so the engine can fall back.

import type { ExaminerTurnRequest } from "../shared/examiner-api";
import { EXAMINER_CALL_CAP, parseExaminerReply, type ExaminerReply } from "./part3";

export type ExaminerFailure = "cap" | "no-token" | "aborted" | "network" | "http" | "invalid" | "timeout";

export type ExaminerOutcome = { ok: true; reply: ExaminerReply; ms: number; raw: string } | { ok: false; reason: ExaminerFailure; ms: number };

/** What the engine needs (tests supply a fake). */
export interface ExaminerPort {
  request(body: ExaminerTurnRequest, signal?: AbortSignal): Promise<ExaminerOutcome>;
  /** Warm a function instance (start of Part 2 prep). No model call. */
  ping(): void;
  readonly calls: number;
}

export class ExaminerClient implements ExaminerPort {
  calls = 0;
  private inFlight: AbortController | null = null;

  constructor(
    private readonly getToken: () => Promise<string | null>,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly cap = EXAMINER_CALL_CAP,
  ) {}

  async request(body: ExaminerTurnRequest, signal?: AbortSignal): Promise<ExaminerOutcome> {
    const started = performance.now();
    const fail = (reason: ExaminerFailure): ExaminerOutcome => ({ ok: false, reason, ms: performance.now() - started });
    if (this.calls >= this.cap) return fail("cap");
    const token = await this.getToken();
    if (!token) return fail("no-token");
    if (signal?.aborted) return fail("aborted");

    // One request in flight: a new one replaces the old.
    this.inFlight?.abort();
    const ctrl = new AbortController();
    this.inFlight = ctrl;
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort);
    this.calls++;

    try {
      const res = await this.fetchImpl("/api/examiner", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) return fail("http");
      const raw = await readReply(res.body, ctrl);
      const reply = parseExaminerReply(raw, body.secondsLeft);
      return reply ? { ok: true, reply, ms: performance.now() - started, raw } : fail("invalid");
    } catch {
      return fail(ctrl.signal.aborted ? "aborted" : "network");
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (this.inFlight === ctrl) this.inFlight = null;
    }
  }

  ping(): void {
    void (async () => {
      const token = await this.getToken();
      if (!token) return;
      try {
        await this.fetchImpl("/api/examiner", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ kind: "ping" }),
        });
      } catch {
        // Warm-up only.
      }
    })();
  }
}

/**
 * Reads the streamed reply. "[NEXT]" / "[END]" are decided as soon as the
 * token is complete; the rest of the stream is dropped.
 */
async function readReply(body: ReadableStream<Uint8Array>, ctrl: AbortController): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    const t = text.trimStart();
    if (t.startsWith("[") && t.includes("]")) {
      ctrl.abort();
      break;
    }
  }
  return text + decoder.decode();
}

/** Resolves with the outcome, or a timeout failure after `ms` (aborting the request). */
export function withDeadline(p: Promise<ExaminerOutcome>, ms: number, onTimeout: () => void): Promise<ExaminerOutcome> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<ExaminerOutcome>((resolve) => {
    timer = setTimeout(() => {
      // Settle first: aborting may resolve the request itself as "aborted".
      resolve({ ok: false, reason: "timeout", ms });
      onTimeout();
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
