import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXED_SET } from "../exams/ielts-fixed-set";
import { getToken, login, prepareSession, resetTokenCache, sessionInfo, storedPassphrase, takePreparedItems } from "./token-client";

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  resetTokenCache();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ok = (token = "t1") =>
  vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => new Response(JSON.stringify({ token, expiresAt: Date.now() + 45 * 60_000 }), { status: 200 }));

describe("token client", () => {
  it("logs in, stores the passphrase and caches the token", async () => {
    const f = ok();
    expect(await login("enfermero2027", f as typeof fetch)).toBe("ok");
    expect(storedPassphrase()).toBe("enfermero2027");
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body))).toEqual({ passphrase: "enfermero2027" });
    expect(await getToken(f as typeof fetch)).toBe("t1");
    expect(f).toHaveBeenCalledOnce();
  });

  it("doesn't store a wrong passphrase", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "wrong-passphrase" }), { status: 401 }));
    expect(await login("nope", f as unknown as typeof fetch)).toBe("wrong");
    expect(storedPassphrase()).toBeNull();
  });

  it("reports the server as unavailable on network or config errors", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await login("x", down as unknown as typeof fetch)).toBe("unavailable");
    const notConfigured = vi.fn(async () => new Response("{}", { status: 500 }));
    expect(await login("x", notConfigured as unknown as typeof fetch)).toBe("unavailable");
  });

  it("reports the daily cap, keeping the (correct) passphrase", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: "daily-cap" }), { status: 429 }));
    expect(await login("enfermero2027", f as unknown as typeof fetch)).toBe("cap");
    expect(storedPassphrase()).toBe("enfermero2027");
  });

  it("keeps the profile, due words and last full test from the database", async () => {
    const body = {
      token: "t",
      expiresAt: Date.now() + 45 * 60_000,
      items: null,
      season: null,
      profile: { level: 2, pauseP90Ms: 1_500, testDate: null },
      dueWords: [{ word: "triage", es: "clasificación" }],
      lastFull: { overall: 6.5, startedAt: "2026-09-29T15:00:00Z" },
    };
    await login("p", vi.fn(async () => new Response(JSON.stringify(body))) as unknown as typeof fetch);
    expect(sessionInfo()).toEqual({ profile: body.profile, dueWords: body.dueWords, lastFull: body.lastFull });
  });

  it("keeps the questions the server selected, for one exam", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ token: "t", expiresAt: Date.now() + 45 * 60_000, items: FIXED_SET, season: "2026-09" }), { status: 200 }));
    await login("p", f as unknown as typeof fetch);
    expect(takePreparedItems()).toEqual({ items: FIXED_SET, season: "2026-09" });
    expect(takePreparedItems()).toBeNull(); // used once
  });

  it("prepares a fresh session with the stored passphrase", async () => {
    expect(await prepareSession(ok() as typeof fetch)).toBe("none");
    await login("p", ok("t1") as typeof fetch);
    const f = ok("t2");
    expect(await prepareSession(f as typeof fetch)).toBe("ok");
    expect(f).toHaveBeenCalledOnce();
  });

  it("returns null without a stored passphrase", async () => {
    expect(await getToken(ok() as typeof fetch)).toBeNull();
  });

  it("refreshes a token older than 30 minutes with the stored passphrase", async () => {
    vi.useFakeTimers();
    await login("p", ok("old") as typeof fetch);
    vi.advanceTimersByTime(31 * 60_000);
    const f = ok("new");
    expect(await getToken(f as typeof fetch)).toBe("new");
    expect(f).toHaveBeenCalledOnce();
  });
});
