// /api/sessions, /api/history, /api/vocab and /api/keepalive with Supabase's
// REST API mocked (fetch): tests never touch a real database.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_GRADE } from "../src/shared/grade.fixture";
import type { SaveSessionRequest } from "../src/shared/persistence-api";
import { overallOf, parseSaveSession, vocabRows } from "./_lib/persistence";

const { POST: saveSession } = await import("./sessions");
const { GET: history } = await import("./history");
const vocab = await import("./vocab");
const { GET: keepalive } = await import("./keepalive");

const PASS = "enfermero2027";
const DB = "https://db.example.supabase.co";
const fetchMock = vi.fn();

const SESSION: SaveSessionRequest = {
  id: "3f2c1a9e-8b7d-4c6e-9f10-1a2b3c4d5e6f",
  startedAt: "2026-09-30T13:17:16.000Z",
  exam: "ielts",
  mode: "full",
  level: 3,
  season: "2026-09",
  topicIds: ["p1-work", "p1-shoes", "p1-paper", "p2-noisy-place"],
  transcript: { answers: [], notes: "", finished: true, endedEarly: false, examinerName: "Ava", feedbackLevel: 2 },
  metrics: { latency: {}, counters: {} },
  grade: SAMPLE_GRADE,
  pauseP90Ms: 1_234.6,
  dueWords: ["triage"],
};

function req(url: string, init: { method?: string; body?: unknown; pass?: string | null; auth?: string } = {}): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.pass !== null) headers["x-app-passphrase"] = init.pass ?? PASS;
  if (init.auth) headers.authorization = init.auth;
  return new Request(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const calls = () => fetchMock.mock.calls as [string, RequestInit][];

beforeEach(() => {
  vi.stubEnv("APP_PASSPHRASE", PASS);
  vi.stubEnv("SUPABASE_URL", DB);
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.stubEnv("CRON_SECRET", "c".repeat(40));
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/sessions", () => {
  it("upserts through save_session with the overall computed on the server", async () => {
    const res = await saveSession(req("/api/sessions", { method: "POST", body: SESSION }));
    expect(res.status).toBe(200);
    const [url, init] = calls()[0]!;
    expect(url).toBe(`${DB}/rest/v1/rpc/save_session`);
    const { s } = JSON.parse(init.body as string) as { s: Record<string, unknown> };
    expect(s).toMatchObject({ id: SESSION.id, started_at: SESSION.startedAt, level: 3, overall: 5.5, pause_p90: 1_235, due_words: ["triage"] });
    expect(s.topic_ids).toEqual(SESSION.topicIds);
  });

  it("accepts a session without a grade (the first save, when the exam ends)", async () => {
    const res = await saveSession(req("/api/sessions", { method: "POST", body: { ...SESSION, grade: null } }));
    expect(res.status).toBe(200);
    const { s } = JSON.parse(calls()[0]![1].body as string) as { s: Record<string, unknown> };
    expect(s.grade).toBeNull();
    expect(s.overall).toBeNull();
  });

  it("refuses a missing passphrase, and a malformed body, without touching the database", async () => {
    expect((await saveSession(req("/api/sessions", { method: "POST", body: SESSION, pass: null }))).status).toBe(401);
    expect((await saveSession(req("/api/sessions", { method: "POST", body: SESSION, pass: "wrong" }))).status).toBe(401);
    expect((await saveSession(req("/api/sessions", { method: "POST", body: { ...SESSION, id: "not-a-uuid" } }))).status).toBe(400);
    expect((await saveSession(req("/api/sessions", { method: "POST", body: { ...SESSION, grade: { bad: 1 } } }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a database failure so the browser retries", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    expect((await saveSession(req("/api/sessions", { method: "POST", body: SESSION }))).status).toBe(502);
  });
});

describe("GET /api/history", () => {
  it("lists sessions with their bands, newest first", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: SESSION.id, started_at: SESSION.startedAt, exam: "ielts", mode: "full", level: 3, overall: "6.5", fc: 7, lr: 6, gr: 6 },
          { id: "b", started_at: "2026-09-29T10:00:00Z", exam: "ielts", mode: "part1", level: 2, overall: null, fc: null, lr: null, gr: null },
        ]),
      ),
    );
    const res = await history(req("/api/history"));
    expect(await res.json()).toEqual([
      { id: SESSION.id, startedAt: SESSION.startedAt, exam: "ielts", mode: "full", level: 3, overall: 6.5, bands: { fc: 7, lr: 6, gr: 6 } },
      { id: "b", startedAt: "2026-09-29T10:00:00Z", exam: "ielts", mode: "part1", level: 2, overall: null, bands: null },
    ]);
    expect(calls()[0]![0]).toContain("order=started_at.desc");
  });

  it("returns one session in full, and 404 for an unknown id", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ id: SESSION.id, started_at: SESSION.startedAt, exam: "ielts", mode: "full", level: 3, overall: 5.5, fc: 6, lr: 6, gr: 5, transcript: SESSION.transcript, grade: SAMPLE_GRADE }])));
    const one = (await (await history(req(`/api/history?id=${SESSION.id}`))).json()) as { grade: unknown; transcript: unknown };
    expect(one.grade).toEqual(SAMPLE_GRADE);
    expect(one.transcript).toEqual(SESSION.transcript);
    fetchMock.mockResolvedValueOnce(new Response("[]"));
    expect((await history(req(`/api/history?id=${SESSION.id}`))).status).toBe(404);
    expect((await history(req("/api/history?id=x"))).status).toBe(400);
  });

  it("needs the passphrase", async () => {
    expect((await history(req("/api/history", { pass: null }))).status).toBe(401);
  });
});

describe("/api/vocab", () => {
  const item = { word: " Triage ", es: "clasificación", example: "Triage first.", exam: "both", nclex_area: "Management of Care" };

  it("saves words lowercase, once, ignoring ones already saved", async () => {
    const res = await vocab.POST(req("/api/vocab", { method: "POST", body: { action: "save", items: [item, { ...item, word: "triage" }], sessionId: SESSION.id } }));
    expect(res.status).toBe(200);
    const [url, init] = calls()[0]!;
    expect(url).toBe(`${DB}/rest/v1/vocab`);
    expect((init.headers as Record<string, string>).prefer).toContain("resolution=ignore-duplicates");
    expect(JSON.parse(init.body as string)).toEqual([
      { word: "triage", es: "clasificación", example: "Triage first.", exam_tags: ["ielts", "nclex"], nclex_area: "Management of Care", first_seen_session: SESSION.id },
    ]);
  });

  it("sets the mastered toggle with a quoted filter", async () => {
    await vocab.POST(req("/api/vocab", { method: "POST", body: { action: "mastered", word: "Coping, mechanism", mastered: true } }));
    const [url, init] = calls()[0]!;
    expect(init.method).toBe("PATCH");
    expect(decodeURIComponent(url)).toBe(`${DB}/rest/v1/vocab?word=eq."coping, mechanism"`);
    expect(JSON.parse(init.body as string)).toEqual({ mastered: true });
  });

  it("lists words, and rejects bad requests", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ word: "triage", es: "x", example: "", exam_tags: ["nclex"], nclex_area: "none", times_seen: 1, times_used_correctly: 0, mastered: false, created_at: "t" }])));
    const list = (await (await vocab.GET(req("/api/vocab"))).json()) as { word: string; examTags: string[] }[];
    expect(list[0]).toMatchObject({ word: "triage", examTags: ["nclex"], timesSeen: 1 });
    expect((await vocab.POST(req("/api/vocab", { method: "POST", body: { action: "save", items: [], sessionId: null } }))).status).toBe(400);
    expect((await vocab.GET(req("/api/vocab", { pass: null }))).status).toBe(401);
  });
});

describe("GET /api/keepalive", () => {
  it("updates the heartbeat with the cron secret, and refuses without it", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify("2026-10-01T12:00:00Z")));
    const ok = await keepalive(req("/api/keepalive", { pass: null, auth: `Bearer ${"c".repeat(40)}` }));
    expect(await ok.json()).toEqual({ ok: true, beatAt: "2026-10-01T12:00:00Z" });
    expect(calls()[0]![0]).toBe(`${DB}/rest/v1/rpc/keepalive`);
    expect((await keepalive(req("/api/keepalive", { pass: null }))).status).toBe(401);
    expect((await keepalive(req("/api/keepalive", { pass: null, auth: "Bearer nope" }))).status).toBe(401);
  });
});

describe("persistence helpers", () => {
  it("computes the overall like the browser (rounded down to a half band)", () => {
    const g = (a: number, b: number, c: number) => ({ fluency_coherence: { band: a }, lexical_resource: { band: b }, grammatical_range: { band: c } });
    expect(overallOf(g(8, 8, 8))).toBe(8);
    expect(overallOf(g(7, 8, 7))).toBe(7);
    expect(overallOf(g(7, 8, 8))).toBe(7.5);
  });

  it("validates a save request", () => {
    expect(parseSaveSession(SESSION)).not.toBeNull();
    expect(parseSaveSession({ ...SESSION, level: 4 })).toBeNull();
    expect(parseSaveSession({ ...SESSION, dueWords: new Array(31).fill("x") })).toBeNull();
  });

  it("maps exam tags and unknown areas safely", () => {
    const rows = vocabRows({ action: "save", sessionId: null, items: [{ word: "shift", es: "turno", example: "", exam: "ielts", nclex_area: "none" }, { word: "bolus", es: "bolo", example: "", exam: "nclex", nclex_area: "Cardiology" as never }] });
    expect(rows.map((r) => [r.exam_tags, r.nclex_area])).toEqual([[["ielts"], "none"], [["nclex"], "none"]]);
  });
});
