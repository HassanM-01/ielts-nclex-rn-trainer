// Stateless session tokens (SPEC 4, "Auth"): HMAC-SHA256 with SESSION_SECRET,
// 45 min TTL. /api/examiner and /api/grade verify them without touching the
// database.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const TOKEN_TTL_MS = 45 * 60 * 1000;

export interface TokenPayload {
  /** Session id. */
  sid: string;
  /** Expiry, epoch ms. */
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function issueToken(secret: string, now = Date.now()): { token: string; payload: TokenPayload } {
  const payload: TokenPayload = { sid: randomUUID(), exp: now + TOKEN_TTL_MS };
  const body = b64url(Buffer.from(JSON.stringify(payload)));
  return { token: `${body}.${b64url(sign(body, secret))}`, payload };
}

/** Returns the payload if the token is authentic and unexpired, else null. */
export function verifyToken(token: string | null | undefined, secret: string, now = Date.now()): TokenPayload | null {
  if (!token) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = sign(body, secret);
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<TokenPayload>;
    if (typeof payload.sid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= now) return null;
    return { sid: payload.sid, exp: payload.exp };
  } catch {
    return null;
  }
}

/** Constant-time string comparison (for the passphrase). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", "compare").update(a).digest();
  const hb = createHmac("sha256", "compare").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function bearer(request: Request): string | null {
  const h = request.headers.get("authorization");
  const m = h ? /^Bearer\s+(.+)$/i.exec(h) : null;
  return m?.[1]?.trim() ?? null;
}
