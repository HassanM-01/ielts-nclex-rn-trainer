import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fullBank } from "../scripts/bank/test-fixtures";
import { verifyToken } from "./_lib/token";

const bankMock = vi.fn(() => fullBank());
vi.mock("./_lib/bank.js", () => ({ loadBank: () => bankMock() }));

const { POST } = await import("./session-start");

const SECRET = "s".repeat(64);

function req(body: unknown): Request {
  return new Request("http://localhost/api/session-start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("APP_PASSPHRASE", "enfermero2027");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/session-start", () => {
  it("issues a verifiable 45-minute token for the right passphrase", async () => {
    const res = await POST(req({ passphrase: " enfermero2027 " }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number };
    const payload = verifyToken(body.token, SECRET);
    expect(payload?.exp).toBe(body.expiresAt);
    expect(body.expiresAt - Date.now()).toBeGreaterThan(44 * 60_000);
  });

  it("returns this session's questions from the bank", async () => {
    const res = await POST(req({ passphrase: "enfermero2027" }));
    const body = (await res.json()) as { items: { part1: unknown[]; part2: { id: string }; part3: { id: string } }; season: string | null };
    expect(body.items.part1).toHaveLength(3);
    expect(body.items.part3.id).toBe(body.items.part2.id.replace("p2-", "p3-"));
    expect(["2026-09", null]).toContain(body.season);
  });

  it("still issues a token when the bank is unavailable (the browser uses its fixed set)", async () => {
    bankMock.mockReturnValueOnce([]);
    const res = await POST(req({ passphrase: "enfermero2027" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; items: unknown };
    expect(body.items).toBeNull();
    expect(verifyToken(body.token, SECRET)).not.toBeNull();
  });

  it("refuses a wrong or missing passphrase", async () => {
    expect((await POST(req({ passphrase: "Enfermero2027" }))).status).toBe(401);
    expect((await POST(req({}))).status).toBe(401);
    expect((await POST(req("not json"))).status).toBe(401);
  });

  it("reports missing configuration", async () => {
    vi.stubEnv("APP_PASSPHRASE", "");
    const res = await POST(req({ passphrase: "" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "not-configured" });
  });
});

describe("POST /api/session-start with the database (step 6)", () => {
  const INFO = {
    today: 2,
    recent_part1: ["p1-work", "p1-shoes"],
    recent_part2: ["p2-noisy-place"],
    profile: { level: 2, pause_p90: 1_900, ielts_test_date: null },
    due_words: [{ word: "triage", es: "clasificación" }],
    last_full: { overall: "6.5", started_at: "2026-09-29T15:00:00Z" },
  };
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://db.example.supabase.co/");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.stubEnv("DAILY_SESSION_CAP", "12");
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("makes one RPC with the secret key on the apikey header, and returns profile, due words and the last full test", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(INFO)));
    const res = await POST(req({ passphrase: "enfermero2027" }));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://db.example.supabase.co/rest/v1/rpc/session_start_info");
    expect((init.headers as Record<string, string>).apikey).toBe("sb_secret_test");
    expect(init.headers).not.toHaveProperty("authorization");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.profile).toEqual({ level: 2, pauseP90Ms: 1_900, testDate: null });
    expect(body.dueWords).toEqual([{ word: "triage", es: "clasificación" }]);
    expect(body.lastFull).toEqual({ overall: 6.5, startedAt: "2026-09-29T15:00:00Z" });
  });

  it("filters out recent topics and cards", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(INFO)));
    for (let i = 0; i < 20; i++) {
      const body = (await (await POST(req({ passphrase: "enfermero2027" }))).json()) as {
        items: { part1: { id: string }[]; part2: { id: string } };
      };
      expect(body.items.part2.id).not.toBe("p2-noisy-place");
      expect(body.items.part1.map((t) => t.id)).not.toContain("p1-shoes");
    }
  });

  it("refuses a token at the daily cap", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...INFO, today: 12 })));
    const res = await POST(req({ passphrase: "enfermero2027" }));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "daily-cap" });
  });

  it("still issues a token and questions when Supabase is down (no cap, no filter)", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await POST(req({ passphrase: "enfermero2027" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; items: unknown; profile: unknown; dueWords: unknown[] };
    expect(verifyToken(body.token, SECRET)).not.toBeNull();
    expect(body.items).not.toBeNull();
    expect(body.profile).toBeNull();
    expect(body.dueWords).toEqual([]);
  });

  it("doesn't call the database for a wrong passphrase", async () => {
    await POST(req({ passphrase: "nope" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
