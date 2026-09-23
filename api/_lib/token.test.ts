import { describe, expect, it } from "vitest";
import { bearer, issueToken, safeEqual, TOKEN_TTL_MS, verifyToken } from "./token";

const SECRET = "a".repeat(64);

describe("session tokens", () => {
  it("verifies a fresh token and returns its payload", () => {
    const { token, payload } = issueToken(SECRET, 1_000);
    expect(payload.exp).toBe(1_000 + TOKEN_TTL_MS);
    expect(verifyToken(token, SECRET, 2_000)).toEqual(payload);
  });

  it("rejects an expired token (45 min TTL)", () => {
    const { token } = issueToken(SECRET, 0);
    expect(verifyToken(token, SECRET, TOKEN_TTL_MS - 1)).not.toBeNull();
    expect(verifyToken(token, SECRET, TOKEN_TTL_MS)).toBeNull();
  });

  it("rejects a token signed with another secret or tampered with", () => {
    const { token } = issueToken(SECRET, 0);
    expect(verifyToken(token, "b".repeat(64), 1)).toBeNull();
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sid: "x", exp: Number.MAX_SAFE_INTEGER })).toString("base64url");
    expect(verifyToken(`${forged}.${mac}`, SECRET, 1)).toBeNull();
    expect(verifyToken(`${body}.${mac}.x`, SECRET, 1)).toBeNull();
    expect(verifyToken("garbage", SECRET, 1)).toBeNull();
    expect(verifyToken(null, SECRET, 1)).toBeNull();
  });

  it("compares passphrases exactly", () => {
    expect(safeEqual("enfermero2027", "enfermero2027")).toBe(true);
    expect(safeEqual("enfermero2027", "Enfermero2027")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });

  it("reads a bearer token", () => {
    expect(bearer(new Request("http://x", { headers: { authorization: "Bearer abc.def" } }))).toBe("abc.def");
    expect(bearer(new Request("http://x"))).toBeNull();
  });
});
