import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyToken } from "./_lib/token";
import { POST } from "./session-start";

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
