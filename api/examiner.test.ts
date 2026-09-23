// /api/examiner with the Anthropic SDK mocked: tests never call the real API.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueToken } from "./_lib/token";

const streamMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: streamMock };
  },
}));

const { POST } = await import("./examiner");

const SECRET = "s".repeat(64);

function fakeStream(texts: string[]) {
  const abort = vi.fn();
  return {
    abort,
    async *[Symbol.asyncIterator]() {
      yield { type: "message_start" };
      for (const text of texts) yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
      yield { type: "message_stop" };
    },
  };
}

const TURN = {
  kind: "turn",
  part2Prompt: "Describe a noisy place you have been to.",
  questions: ["What are the noisiest places in your town or city?"],
  index: 0,
  exchange: [
    { role: "examiner", text: "What are the noisiest places in your town or city?" },
    { role: "candidate", text: "the bus station" },
  ],
  secondsLeft: 250,
  followupsUsed: 0,
  allowance: "1-per-question",
};

function req(body: unknown, token: string | null = issueToken(SECRET).token): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/examiner", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("EXAMINER_MODEL", "claude-haiku-4-5-20251001");
  streamMock.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/examiner", () => {
  it("streams the model's reply as plain text", async () => {
    streamMock.mockReturnValue(fakeStream(["Why is the bus ", "station so noisy?"]));
    const res = await POST(req(TURN));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("Why is the bus station so noisy?");
  });

  it("calls EXAMINER_MODEL with max_tokens 80, no thinking, a small prompt and the request's abort signal", async () => {
    streamMock.mockReturnValue(fakeStream(["[NEXT]"]));
    const r = req(TURN);
    await (await POST(r)).text();
    const [params, options] = streamMock.mock.calls[0] as [Record<string, unknown>, { signal: AbortSignal }];
    expect(params.model).toBe("claude-haiku-4-5-20251001");
    expect(params.max_tokens).toBe(80);
    expect(params).not.toHaveProperty("thinking");
    expect(typeof params.system).toBe("string");
    const messages = params.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain("Candidate: the bus station");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("answers a ping without calling the model", async () => {
    const res = await POST(req({ kind: "ping" }));
    expect(res.status).toBe(204);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("refuses missing, bad or expired tokens", async () => {
    expect((await POST(req(TURN, null))).status).toBe(401);
    expect((await POST(req(TURN, "x.y"))).status).toBe(401);
    expect((await POST(req(TURN, issueToken(SECRET, Date.now() - 46 * 60_000).token))).status).toBe(401);
    expect((await POST(req(TURN, issueToken("other".repeat(13)).token))).status).toBe(401);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const res = await POST(req({ ...TURN, index: 9 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad-request" });
  });

  it("reports missing configuration instead of calling the model", async () => {
    vi.stubEnv("EXAMINER_MODEL", "");
    const res = await POST(req(TURN));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "not-configured" });
  });
});
