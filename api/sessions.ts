// POST /api/sessions (SPEC 12): saves a finished session, upserting by the
// client's uuid so retries are safe. The browser saves once when the exam
// ends and again when the grade arrives; the database never lets a save
// without a grade erase one, and counts saved-word reviews only once.

import { passphraseOk } from "./_lib/auth.js";
import { dbConfigured, rpc } from "./_lib/db.js";
import { error, json, readJson } from "./_lib/http.js";
import { parseSaveSession, sessionRow } from "./_lib/persistence.js";

export async function POST(request: Request): Promise<Response> {
  if (!passphraseOk(request)) return error("unauthorized", 401);
  if (!dbConfigured()) return error("not-configured", 500);
  const body = parseSaveSession(await readJson(request, 600_000));
  if (!body) return error("bad-request", 400);
  try {
    await rpc("save_session", { s: sessionRow(body) }, 8_000);
    return json({ ok: true });
  } catch {
    return error("upstream", 502);
  }
}
