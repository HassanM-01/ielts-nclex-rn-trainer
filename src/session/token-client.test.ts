import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToken, login, resetTokenCache, storedPassphrase } from "./token-client";

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
