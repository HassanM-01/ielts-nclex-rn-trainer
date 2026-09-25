// POST /api/session-start (SPEC 4 "Auth", SPEC 9 "Selection"): passphrase
// -> signed session token plus the questions for this session.
//
// Step 4 runs SPEC 4's "Supabase unreachable" path: no daily cap and no
// repeat filter yet. Step 6 adds the one database round trip (today's count,
// recent topic ids, the profile row).

import type { SessionStartResponse } from "../src/shared/examiner-api";
import { loadBank } from "./_lib/bank.js";
import { error, json, readJson } from "./_lib/http.js";
import { selectItems } from "./_lib/select.js";
import { issueToken, safeEqual } from "./_lib/token.js";

function parseDate(x: unknown): Date | null {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return null;
  const d = new Date(`${x}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SESSION_SECRET;
  const passphrase = process.env.APP_PASSPHRASE;
  if (!secret || !passphrase) return error("not-configured", 500);

  const body = await readJson(request, 2_000);
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof b.passphrase !== "string" || !safeEqual(b.passphrase.trim(), passphrase)) return error("wrong-passphrase", 401);

  const { token, payload } = issueToken(secret);
  const selection = selectItems(loadBank(), { now: new Date(), testDate: parseDate(b.testDate) });
  const res: SessionStartResponse = {
    token,
    expiresAt: payload.exp,
    items: selection?.items ?? null,
    season: selection?.season ?? null,
  };
  return json(res);
}
