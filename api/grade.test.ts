// /api/grade with the Anthropic SDK mocked: tests never call the real API.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GradeEvent, GradeRequest } from "../src/shared/grade";
import { SAMPLE_GRADE } from "../src/shared/grade.fixture";
import { buildGradeMessage, GradeOutput, parseGradeRequest } from "./_lib/grade-prompt";
import { issueToken } from "./_lib/token";

const streamMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: streamMock };
  },
}));

const { POST } = await import("./grade");

const SECRET = "s".repeat(64);

/** A fake SDK stream: yields the text in chunks, then a final message with a stop reason. */
function fakeStream(text: string, stop = "end_turn", opts: { throwAfter?: number } = {}) {
  const chunks = text.match(/.{1,40}/gs) ?? [];
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "message_start" };
      let n = 0;
      for (const c of chunks) {
        if (opts.throwAfter !== undefined && n++ >= opts.throwAfter) throw new Error("socket hang up");
        yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: c } };
      }
    },
    finalMessage: async () => ({ stop_reason: stop, content: [], usage: { input_tokens: 6_000, output_tokens: 3_000, cache_read_input_tokens: null } }),
  };
}

const REQ: GradeRequest = {
  kind: "grade",
  mode: "full",
  level: 2,
  partial: false,
  answers: [
    {
      part: 1,
      question: "Do you work or are you a student?",
      text: "i work as a nurse in a big hospital",
      outcome: "answered",
      followup: false,
      metrics: { speakingMs: 4_200, words: 9, pausesOver1s: 1, pausesOver2s: 0, firstWordMs: 900 },
    },
    {
      part: 2,
      question: "Describe a noisy place you have been to.",
      text: "the emergency room is very noisy because",
      outcome: "hard-stop",
      followup: false,
      metrics: { speakingMs: 118_000, words: 180, pausesOver1s: 9, pausesOver2s: 4, firstWordMs: 2_100 },
    },
    { part: 3, question: "Why do people like quiet places?", text: "", outcome: "no-answer", followup: false, metrics: null },
    { part: 3, question: "You said calm. Why?", text: "because it is relaxing", outcome: "answered", followup: true, metrics: null },
  ],
  savedWords: [],
  ayuda: [],
  avgConfidence: 1,
};

function req(body: unknown, token: string | null = issueToken(SECRET).token): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/grade", { method: "POST", headers, body: JSON.stringify(body) });
}

async function events(res: Response): Promise<GradeEvent[]> {
  const text = await res.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GradeEvent);
}

const GOOD = JSON.stringify(SAMPLE_GRADE);

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("GRADE_MODEL", "claude-opus-5-5");
  streamMock.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/grade", () => {
  it("streams the model's JSON as deltas, then the validated grade", async () => {
    streamMock.mockReturnValue(fakeStream(GOOD));
    const res = await POST(req(REQ));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const ev = await events(res);
    const deltas = ev.filter((e) => e.t === "delta").map((e) => (e as { v: string }).v);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join("")).toBe(GOOD);
    expect(ev[ev.length - 1]).toEqual({ t: "done", grade: SAMPLE_GRADE, usage: { input: 6_000, output: 3_000 } });
  });

  it("calls GRADE_MODEL with structured outputs, medium effort, the descriptors and the request's signal", async () => {
    streamMock.mockReturnValue(fakeStream(GOOD));
    await (await POST(req(REQ))).text();
    const [params, options] = streamMock.mock.calls[0] as [Record<string, unknown>, { signal: AbortSignal }];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params).not.toHaveProperty("thinking");
    type Schema = { properties: Record<string, { $ref?: string }>; $defs?: Record<string, { properties: Record<string, unknown> }> };
    const oc = params.output_config as { effort: string; format: { type: string; schema: Schema } };
    expect(oc.effort).toBe("medium");
    expect(oc.format.type).toBe("json_schema");
    // Schema order is stream order: evidence before band, criteria first.
    expect(Object.keys(oc.format.schema.properties)).toEqual(Object.keys(SAMPLE_GRADE));
    const ref = oc.format.schema.properties.fluency_coherence?.$ref?.split("/").pop() ?? "";
    const fc = oc.format.schema.$defs?.[ref] ?? (oc.format.schema.properties.fluency_coherence as unknown as { properties: Record<string, unknown> });
    expect(Object.keys(fc.properties)).toEqual(["evidence", "band", "advice_es"]);
    expect(params.system).toContain("Fluent with only very occasional repetition or self-correction.");
    expect(params.system).toContain("When you are torn between two bands, choose the lower one.");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries once after max_tokens, telling the browser to reset", async () => {
    streamMock.mockReturnValueOnce(fakeStream(GOOD.slice(0, 200), "max_tokens")).mockReturnValueOnce(fakeStream(GOOD));
    const ev = await events(await POST(req(REQ)));
    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(ev.filter((e) => e.t === "reset")).toHaveLength(1);
    const afterReset = ev.slice(ev.findIndex((e) => e.t === "reset") + 1);
    expect(afterReset.filter((e) => e.t === "delta").map((e) => (e as { v: string }).v).join("")).toBe(GOOD);
    expect(ev[ev.length - 1]?.t).toBe("done");
    // Both attempts are billed.
    expect((ev[ev.length - 1] as { usage: unknown }).usage).toEqual({ input: 12_000, output: 6_000 });
  });

  it("retries once after a refusal or a network error, then reports the error", async () => {
    streamMock.mockReturnValueOnce(fakeStream("", "refusal")).mockReturnValueOnce(fakeStream(GOOD, "end_turn", { throwAfter: 2 }));
    const ev = await events(await POST(req(REQ)));
    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(ev[ev.length - 1]).toEqual({ t: "error", code: "upstream" });
  });

  it("treats JSON that doesn't match the schema as incomplete", async () => {
    streamMock.mockReturnValue(fakeStream(JSON.stringify({ ...SAMPLE_GRADE, lexical_resource: undefined })));
    const ev = await events(await POST(req(REQ)));
    expect(streamMock).toHaveBeenCalledTimes(2);
    expect(ev[ev.length - 1]).toEqual({ t: "error", code: "incomplete" });
  });

  it("refuses missing or expired tokens and bad bodies without calling the model", async () => {
    expect((await POST(req(REQ, null))).status).toBe(401);
    expect((await POST(req(REQ, issueToken(SECRET, Date.now() - 46 * 60_000).token))).status).toBe(401);
    expect((await POST(req({ ...REQ, level: 4 }))).status).toBe(400);
    expect((await POST(req({ ...REQ, answers: [] }))).status).toBe(400);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("reports missing configuration", async () => {
    vi.stubEnv("GRADE_MODEL", "");
    expect((await POST(req(REQ))).status).toBe(500);
  });
});

describe("grade input and prompt", () => {
  it("accepts a well-formed request and rejects malformed answers", () => {
    expect(parseGradeRequest(REQ)).toEqual(REQ);
    const bad = (a: Record<string, unknown>) => parseGradeRequest({ ...REQ, answers: [{ ...REQ.answers[0], ...a }] });
    expect(bad({ part: 0 })).toBeNull(); // the opening isn't graded
    expect(bad({ outcome: "maybe" })).toBeNull();
    expect(bad({ text: "x".repeat(6_001) })).toBeNull();
    expect(bad({ metrics: { speakingMs: -1, words: 1, pausesOver1s: 0, pausesOver2s: 0, firstWordMs: null } })).toBeNull();
    expect(parseGradeRequest({ ...REQ, avgConfidence: 2 })).toBeNull();
    expect(parseGradeRequest({ ...REQ, savedWords: ["ok", 3] })).toBeNull();
  });

  it("labels the transcript by part and question, with metrics and notes", () => {
    const msg = buildGradeMessage(REQ);
    expect(msg).toContain("Session: full test");
    expect(msg).toContain("Nivel 2 (B2 to C1). Write the upgraded answers at band 7.");
    expect(msg).toContain("reported as 1 for every result");
    expect(msg).toMatch(/## Part 1\n\nQ1\. Examiner: Do you work or are you a student\?\nCandidate: i work as a nurse in a big hospital/);
    expect(msg).toContain("[4.2 s speaking, 9 words, pauses over 1 s: 1, over 2 s: 0, started after 0.9 s]");
    expect(msg).toContain("118.0 s speaking, 180 words, 92 words per minute");
    expect(msg).toContain("[note: the 2-minute limit was reached]");
    expect(msg).toMatch(/## Part 3\n\nQ1\. Examiner: Why do people like quiet places\?\nCandidate: \(no answer\)\n\[note: no answer\]/);
    expect(msg).toContain("Q2 (follow-up). Examiner: You said calm. Why?");
  });

  it("uses each level's upgraded-answer band and a partial-sample note", () => {
    expect(buildGradeMessage({ ...REQ, level: 1 })).toContain("band 6.");
    expect(buildGradeMessage({ ...REQ, level: 3 })).toContain("band 7.5.");
    expect(buildGradeMessage({ ...REQ, partial: true })).toContain("partial sample");
    expect(buildGradeMessage({ ...REQ, mode: "part1", partial: true })).toContain("partial practice: Part 1 only");
  });

  it("the sample grade satisfies the model schema (browser and server agree)", () => {
    expect(GradeOutput.safeParse(SAMPLE_GRADE).success).toBe(true);
  });
});
