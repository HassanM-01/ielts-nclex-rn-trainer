import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXED_SET } from "../exams/ielts-fixed-set";
import type { MetricsSnapshot } from "../metrics/latency";
import type { ExamCheckpoint } from "../session/checkpoint";
import { SAMPLE_GRADE } from "../shared/grade.fixture";

vi.mock("../session/token-client", () => ({ storedPassphrase: () => "enfermero2027" }));

const { buildSaveRequest, flushPending, pendingSaves, queueSave, resetSaveClient, topicIds } = await import("./save-client");

function kv() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const CP: ExamCheckpoint = {
  v: 1,
  id: "3f2c1a9e-8b7d-4c6e-9f10-1a2b3c4d5e6f",
  exam: "ielts",
  mode: "full",
  level: 3,
  feedbackLevel: 2,
  startedAt: "2026-09-30T13:17:16.000Z",
  updatedAt: "2026-09-30T13:30:00.000Z",
  items: FIXED_SET,
  season: "2026-09",
  dueWords: ["triage"],
  examinerName: "Ava",
  voiceURI: null,
  nextStep: 30,
  answers: [
    {
      stepId: "p1-work-q1",
      part: 1,
      question: "Do you work?",
      text: "yes I work as a nurse",
      askedAt: 1,
      committedAt: 2,
      outcome: "answered",
      repeats: 0,
      repeatRequests: 0,
      backupPrompt: false,
      turnIds: [4, 5],
      metrics: { speakingMs: 3_000, words: 6, pausesOver1s: 0, pausesOver2s: 0, firstWordMs: 800 },
    },
  ],
  notes: "",
  finished: true,
  endedEarly: false,
};

const METRICS: MetricsSnapshot = { latency: { commit_to_audio_scripted: [300] }, counters: { stall: 1 }, info: { pause_p90_ms: 1_891.9, voice: "Ava" }, events: [] };

const ok = () => vi.fn(async () => new Response(JSON.stringify({ ok: true })));
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  resetSaveClient();
  vi.useRealTimers();
});
afterEach(() => vi.useRealTimers());

describe("buildSaveRequest", () => {
  it("maps the checkpoint, drops page-only turn ids, and adds fluency stats", () => {
    const r = buildSaveRequest(CP, SAMPLE_GRADE, METRICS);
    expect(r).toMatchObject({ id: CP.id, exam: "ielts", mode: "full", level: 3, season: "2026-09", pauseP90Ms: 1_892, dueWords: ["triage"], grade: SAMPLE_GRADE });
    expect(r.transcript.answers[0]).not.toHaveProperty("turnIds");
    expect(r.transcript.feedbackLevel).toBe(2);
    expect(r.metrics).toMatchObject({ counters: { stall: 1 }, fluency: { words: 6, answered: 1 } });
  });

  it("lists the Part 1 topics and Part 2 card the mode used", () => {
    expect(topicIds(CP)).toEqual([...FIXED_SET.part1.map((t) => t.id), FIXED_SET.part2.id]);
    expect(topicIds({ ...CP, mode: "part1" })).toEqual(FIXED_SET.part1.map((t) => t.id));
    expect(topicIds({ ...CP, mode: "parts23" })).toEqual([FIXED_SET.part2.id]);
  });
});

describe("queueSave", () => {
  it("sends the save with the passphrase header and clears it once confirmed", async () => {
    const store = kv();
    const fetchImpl = ok();
    await queueSave(buildSaveRequest(CP, null, METRICS), { kv: store, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/sessions");
    expect((init.headers as Record<string, string>)["x-app-passphrase"]).toBe("enfermero2027");
    expect(pendingSaves(store)).toEqual([]);
  });

  it("keeps a failed save queued and retries it with backoff", async () => {
    vi.useFakeTimers();
    const store = kv();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 502 }));
    await queueSave(buildSaveRequest(CP, null, METRICS), { kv: store, fetchImpl });
    expect(pendingSaves(store)).toHaveLength(1);
    fetchImpl.mockImplementation(async () => new Response(JSON.stringify({ ok: true })));
    await vi.advanceTimersByTimeAsync(2_100);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(pendingSaves(store)).toEqual([]);
  });

  it("never lets a later save without a grade drop a queued grade", async () => {
    const store = kv();
    const down = vi.fn(async () => new Response("{}", { status: 503 }));
    await queueSave(buildSaveRequest(CP, SAMPLE_GRADE, METRICS), { kv: store, fetchImpl: down });
    await queueSave(buildSaveRequest(CP, null, METRICS), { kv: store, fetchImpl: down });
    expect(pendingSaves(store)).toHaveLength(1);
    expect(pendingSaves(store)[0]?.grade).toEqual(SAMPLE_GRADE);
  });

  it("drops a save the server rejects as malformed (400), instead of retrying forever", async () => {
    const store = kv();
    await queueSave(buildSaveRequest(CP, null, METRICS), { kv: store, fetchImpl: vi.fn(async () => new Response("{}", { status: 400 })) });
    expect(pendingSaves(store)).toEqual([]);
  });

  it("sends a save queued while another flush is running", async () => {
    const store = kv();
    let release: () => void = () => {};
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response(JSON.stringify({ ok: true })));
        }),
    );
    void queueSave(buildSaveRequest(CP, null, METRICS), { kv: store, fetchImpl });
    await settle();
    void queueSave(buildSaveRequest({ ...CP, id: "11111111-2222-4333-8444-555555555555" }, null, METRICS), { kv: store, fetchImpl });
    release();
    await settle();
    release();
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(pendingSaves(store)).toEqual([]);
  });

  it("flushes saves left from an earlier visit", async () => {
    const store = kv();
    await queueSave(buildSaveRequest(CP, null, METRICS), { kv: store, fetchImpl: vi.fn(async () => new Response("{}", { status: 503 })) });
    resetSaveClient();
    const fetchImpl = ok();
    await flushPending({ kv: store, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(pendingSaves(store)).toEqual([]);
  });
});
