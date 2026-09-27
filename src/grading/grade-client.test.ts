import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXED_SET } from "../exams/ielts-fixed-set";
import type { AnswerRecord, ExamCheckpoint } from "../session/checkpoint";
import { SAMPLE_GRADE } from "../shared/grade.fixture";

vi.mock("../session/token-client", () => ({ getToken: vi.fn(async () => "tok") }));

const { buildGradeRequest, currentGradeJob, isPartial, loadSavedGrade, resetGradeJob, startGrading, subscribeGrade } = await import("./grade-client");
const { getToken } = await import("../session/token-client");

const LONG = "I work as a nurse in a big public hospital in the city and I like it very much";

function rec(over: Partial<AnswerRecord>): AnswerRecord {
  return {
    stepId: "p1-work-q1",
    part: 1,
    question: "Do you work or are you a student?",
    text: LONG,
    askedAt: 0,
    committedAt: 1,
    outcome: "answered",
    repeats: 0,
    repeatRequests: 0,
    backupPrompt: false,
    turnIds: [],
    metrics: { speakingMs: 6_000, words: 18, pausesOver1s: 1, pausesOver2s: 0, firstWordMs: 700 },
    ...over,
  };
}

function checkpoint(over: Partial<ExamCheckpoint> = {}): ExamCheckpoint {
  return {
    v: 1,
    id: "s1",
    exam: "ielts",
    mode: "full",
    level: 3,
    feedbackLevel: 2,
    startedAt: "2026-09-26T15:00:00.000Z",
    updatedAt: "2026-09-26T15:00:00.000Z",
    items: FIXED_SET,
    examinerName: "Sonia",
    voiceURI: null,
    nextStep: 20,
    answers: [
      rec({ stepId: "opening-name", part: 0, question: "Can you tell me your full name, please?", text: "Julio Garcia Lopez" }),
      rec({}),
      rec({ stepId: "p2-noisy-place", part: 2, question: "Describe a noisy place you have been to.", outcome: "hard-stop", metrics: undefined }),
      rec({ stepId: "p3-noisy-q1-f", part: 3, question: "Why is that?" }),
      rec({ stepId: "p3-noisy-q2", part: 3, question: "Unasked", outcome: null }),
    ],
    notes: "",
    finished: true,
    endedEarly: false,
    ...over,
  };
}

/** A fetch whose body streams the given NDJSON events, split at awkward places. */
function streamingFetch(events: unknown[], status = 200) {
  const text = events.map((e) => `${JSON.stringify(e)}\n`).join("");
  const pieces = text.match(/[\s\S]{1,23}/g) ?? [];
  return vi.fn(async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of pieces) c.enqueue(new TextEncoder().encode(p));
        c.close();
      },
    });
    return new Response(body, { status });
  });
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetGradeJob());
afterEach(() => vi.unstubAllGlobals());

describe("buildGradeRequest", () => {
  it("sends Parts 1 to 3 (not the opening), labelled, with metrics and the feedback level", () => {
    const r = buildGradeRequest(checkpoint(), 1);
    expect(r?.level).toBe(2);
    expect(r?.mode).toBe("full");
    expect(r?.partial).toBe(false);
    expect(r?.avgConfidence).toBe(1);
    expect(r?.answers.map((a) => [a.part, a.followup, a.outcome])).toEqual([
      [1, false, "answered"],
      [2, false, "hard-stop"],
      [3, true, "answered"],
    ]);
    expect(r?.answers[0]?.metrics?.firstWordMs).toBe(700);
    expect(r?.answers[1]?.metrics).toBeNull();
    expect(JSON.stringify(r)).not.toContain("Julio Garcia");
  });

  it("marks partial modes and early ends as partial samples", () => {
    expect(isPartial({ mode: "part1", finished: true, endedEarly: false })).toBe(true);
    expect(isPartial({ mode: "full", finished: true, endedEarly: true })).toBe(true);
    expect(buildGradeRequest(checkpoint({ mode: "parts23" }), null)?.partial).toBe(true);
    // Unfinished (graded from a checkpoint) is partial, unless grading started at the closing line.
    expect(buildGradeRequest(checkpoint({ finished: false }), null)?.partial).toBe(true);
    expect(buildGradeRequest(checkpoint({ finished: false }), null, true)?.partial).toBe(false);
  });

  it("doesn't grade too little speech, or another exam", () => {
    expect(buildGradeRequest(checkpoint({ answers: [rec({ text: "yes I do" })] }), 1)).toBeNull();
    expect(buildGradeRequest(checkpoint({ exam: "clinical" }), 1)).toBeNull();
  });

  it("defaults the feedback level to Nivel 2 for older checkpoints", () => {
    expect(buildGradeRequest(checkpoint({ feedbackLevel: undefined }), 1)?.level).toBe(2);
  });
});

describe("startGrading", () => {
  it("streams sections as they close, then keeps the final grade", async () => {
    const json = JSON.stringify(SAMPLE_GRADE);
    const cut = json.indexOf(',"lexical_resource"') + 5;
    const fetchImpl = streamingFetch([{ t: "delta", v: json.slice(0, cut) }, { t: "delta", v: json.slice(cut) }, { t: "done", grade: SAMPLE_GRADE, usage: { input: 7_000, output: 2_500 } }]);
    const seen: string[][] = [];
    const unsub = subscribeGrade(() => seen.push([...(currentGradeJob("s1")?.partial.closedKeys ?? [])]));
    const job = startGrading(checkpoint(), 1, { fetchImpl });
    expect(job.status).toBe("streaming");
    await settle();
    unsub();
    expect(currentGradeJob("s1")?.status).toBe("done");
    expect(currentGradeJob("s1")?.grade).toEqual(SAMPLE_GRADE);
    expect(currentGradeJob("s1")?.firstBandAt).not.toBeNull();
    expect(currentGradeJob("s1")?.endedAt).not.toBeNull();
    expect(currentGradeJob("s1")?.usage).toEqual({ input: 7_000, output: 2_500 });
    expect(currentGradeJob("s1")?.fromStorage).toBe(false);
    expect(seen.some((k) => k.length === 1 && k[0] === "fluency_coherence")).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/grade");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("drops the first attempt's text on reset", async () => {
    const json = JSON.stringify(SAMPLE_GRADE);
    const fetchImpl = streamingFetch([{ t: "delta", v: '{"fluency_coherence": {"evidence": ["x"], "band": 2, "advice_es": "y"},' }, { t: "reset" }, { t: "delta", v: json.slice(0, 50) }]);
    startGrading(checkpoint(), 1, { fetchImpl });
    await settle();
    const j = currentGradeJob("s1");
    expect(j?.text).toBe(json.slice(0, 50));
    // The stream ended without "done".
    expect(j?.status).toBe("error");
    expect(j?.failure).toBe("network");
  });

  it("does not start a second request for the same session", async () => {
    const fetchImpl = streamingFetch([{ t: "done", grade: SAMPLE_GRADE }]);
    startGrading(checkpoint(), 1, { fetchImpl });
    startGrading(checkpoint(), 1, { fetchImpl });
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("explains failures: server error event, HTTP error, no token", async () => {
    startGrading(checkpoint(), 1, { fetchImpl: streamingFetch([{ t: "error", code: "refusal" }]) });
    await settle();
    expect(currentGradeJob("s1")).toMatchObject({ status: "error", failure: "server" });

    startGrading(checkpoint(), 1, { force: true, fetchImpl: streamingFetch([], 500) });
    await settle();
    expect(currentGradeJob("s1")?.failure).toBe("server");

    vi.mocked(getToken).mockResolvedValueOnce(null);
    const fetchImpl = streamingFetch([]);
    startGrading(checkpoint(), 1, { force: true, fetchImpl });
    await settle();
    expect(currentGradeJob("s1")?.failure).toBe("no-token");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports too little to grade without calling the server", () => {
    const fetchImpl = streamingFetch([]);
    expect(startGrading(checkpoint({ answers: [rec({ text: "no" })] }), 1, { fetchImpl }).status).toBe("too-short");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("saves the grade so a reload shows it without grading again", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
    startGrading(checkpoint(), 1, { fetchImpl: streamingFetch([{ t: "done", grade: SAMPLE_GRADE }]) });
    await settle();
    expect(loadSavedGrade("s1")).toEqual(SAMPLE_GRADE);
    expect(loadSavedGrade("other")).toBeNull();

    resetGradeJob();
    const fetchImpl = streamingFetch([]);
    const reloaded = startGrading(checkpoint(), 1, { fetchImpl });
    expect(reloaded.status).toBe("done");
    expect(reloaded.fromStorage).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
