import { describe, expect, it, vi } from "vitest";
import type { ExaminerTurnRequest } from "../shared/examiner-api";
import { ExaminerClient, withDeadline } from "./examiner-client";

const BODY: ExaminerTurnRequest = {
  kind: "turn",
  part2Prompt: "Describe a noisy place you have been to.",
  questions: ["What are the noisiest places in your town or city?"],
  index: 0,
  exchange: [
    { role: "examiner", text: "What are the noisiest places in your town or city?" },
    { role: "candidate", text: "The market and the bus station" },
  ],
  secondsLeft: 250,
  followupsUsed: 0,
  allowance: "1-per-question",
};

/** A Response whose body arrives in chunks. */
function streamed(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const ch of chunks) c.enqueue(enc.encode(ch));
        c.close();
      },
    }),
    { status },
  );
}

const token = async () => "tok";

describe("ExaminerClient", () => {
  it("sends the token and parses a streamed follow-up", async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => streamed(["Why are those ", "places so noisy?"]));
    const c = new ExaminerClient(token, fetchImpl as typeof fetch);
    const out = await c.request(BODY);
    expect(out.ok && out.reply).toEqual({ type: "followup", text: "Why are those places so noisy?" });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(String(init?.body))).toEqual(BODY);
    expect(c.calls).toBe(1);
  });

  it("decides [NEXT] as soon as the token is complete", async () => {
    const c = new ExaminerClient(token, (async () => streamed(["[NE", "XT]", " and more"])) as typeof fetch);
    const out = await c.request(BODY);
    expect(out.ok && out.reply).toEqual({ type: "next" });
  });

  it("falls back on invalid output, HTTP errors and network errors", async () => {
    const invalid = new ExaminerClient(token, (async () => streamed(["Great answer! Why?"])) as typeof fetch);
    expect(await invalid.request(BODY)).toMatchObject({ ok: false, reason: "invalid" });
    const http = new ExaminerClient(token, (async () => new Response("nope", { status: 500 })) as typeof fetch);
    expect(await http.request(BODY)).toMatchObject({ ok: false, reason: "http" });
    const net = new ExaminerClient(token, (async () => {
      throw new TypeError("offline");
    }) as typeof fetch);
    expect(await net.request(BODY)).toMatchObject({ ok: false, reason: "network" });
  });

  it("does nothing without a token", async () => {
    const fetchImpl = vi.fn();
    const c = new ExaminerClient(async () => null, fetchImpl as unknown as typeof fetch);
    expect(await c.request(BODY)).toMatchObject({ ok: false, reason: "no-token" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops at the session cap", async () => {
    const c = new ExaminerClient(token, (async () => streamed(["[NEXT]"])) as typeof fetch, 2);
    await c.request(BODY);
    await c.request(BODY);
    expect(await c.request(BODY)).toMatchObject({ ok: false, reason: "cap" });
    expect(c.calls).toBe(2);
  });

  it("keeps one request in flight: a new one aborts the old", async () => {
    const signals: AbortSignal[] = [];
    const fetchImpl = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init!.signal!);
      await new Promise((r) => setTimeout(r, 20));
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return streamed(["[NEXT]"]);
    }) as typeof fetch;
    const c = new ExaminerClient(token, fetchImpl);
    const first = c.request(BODY);
    await new Promise((r) => setTimeout(r, 1));
    const second = c.request(BODY);
    expect(await first).toMatchObject({ ok: false, reason: "aborted" });
    expect(await second).toMatchObject({ ok: true });
    expect(signals[0]?.aborted).toBe(true);
  });

  it("aborts when the caller's signal aborts", async () => {
    const ctrl = new AbortController();
    const fetchImpl = ((_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    const c = new ExaminerClient(token, fetchImpl);
    const p = c.request(BODY, ctrl.signal);
    await new Promise((r) => setTimeout(r, 1));
    ctrl.abort();
    expect(await p).toMatchObject({ ok: false, reason: "aborted" });
  });

  it("pings without counting toward the cap", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const c = new ExaminerClient(token, fetchImpl as unknown as typeof fetch);
    c.ping();
    await new Promise((r) => setTimeout(r, 1));
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(c.calls).toBe(0);
  });
});

describe("withDeadline", () => {
  it("times out and calls onTimeout", async () => {
    const onTimeout = vi.fn();
    const out = await withDeadline(new Promise(() => undefined), 10, onTimeout);
    expect(out).toMatchObject({ ok: false, reason: "timeout" });
    expect(onTimeout).toHaveBeenCalledOnce();
  });
  it("passes a fast result through", async () => {
    const out = await withDeadline(Promise.resolve({ ok: true, reply: { type: "next" }, ms: 5, raw: "[NEXT]" }), 1_000, () => undefined);
    expect(out.ok).toBe(true);
  });
});
