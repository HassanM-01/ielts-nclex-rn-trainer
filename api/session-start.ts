// POST /api/session-start (SPEC 4, "Auth"): passphrase -> signed session
// token. Step 3 version: token only. Step 4 adds the daily cap, question
// selection and the one database round trip.

import type { SessionStartResponse } from "../src/shared/examiner-api";
import { error, json, readJson } from "./_lib/http.js";
import { issueToken, safeEqual } from "./_lib/token.js";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SESSION_SECRET;
  const passphrase = process.env.APP_PASSPHRASE;
  if (!secret || !passphrase) return error("not-configured", 500);

  const body = await readJson(request, 2_000);
  const given = body && typeof body === "object" ? (body as Record<string, unknown>).passphrase : undefined;
  if (typeof given !== "string" || !safeEqual(given.trim(), passphrase)) return error("wrong-passphrase", 401);

  const { token, payload } = issueToken(secret);
  const res: SessionStartResponse = { token, expiresAt: payload.exp };
  return json(res);
}
