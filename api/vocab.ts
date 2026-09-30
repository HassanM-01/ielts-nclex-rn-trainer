// /api/vocab (SPEC 12): GET lists saved words; POST saves words ("Guardar",
// and the one-time move of words saved in localStorage during step 5) or
// sets the mastered toggle. Passphrase header.

import type { VocabRow } from "../src/shared/persistence-api";
import { passphraseOk } from "./_lib/auth.js";
import { dbConfigured, eq, insertIgnore, select, update } from "./_lib/db.js";
import { error, json, readJson } from "./_lib/http.js";
import { parseVocabRequest, vocabRows } from "./_lib/persistence.js";

interface Row {
  word: string;
  es: string;
  example: string;
  exam_tags: string[];
  nclex_area: string;
  times_seen: number;
  times_used_correctly: number;
  mastered: boolean;
  created_at: string;
}

function guard(request: Request): Response | null {
  if (!passphraseOk(request)) return error("unauthorized", 401);
  if (!dbConfigured()) return error("not-configured", 500);
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const denied = guard(request);
  if (denied) return denied;
  try {
    const rows = await select<Row>("vocab", "select=*&order=mastered.asc,created_at.desc&limit=1000");
    const out: VocabRow[] = rows.map((r) => ({
      word: r.word,
      es: r.es,
      example: r.example,
      examTags: r.exam_tags,
      nclexArea: r.nclex_area,
      timesSeen: r.times_seen,
      timesUsedCorrectly: r.times_used_correctly,
      mastered: r.mastered,
      createdAt: r.created_at,
    }));
    return json(out);
  } catch {
    return error("upstream", 502);
  }
}

export async function POST(request: Request): Promise<Response> {
  const denied = guard(request);
  if (denied) return denied;
  const body = parseVocabRequest(await readJson(request, 100_000));
  if (!body) return error("bad-request", 400);
  try {
    if (body.action === "save") await insertIgnore("vocab", vocabRows(body));
    else await update("vocab", `word=${eq(body.word.trim().toLowerCase())}`, { mastered: body.mastered });
    return json({ ok: true });
  } catch {
    return error("upstream", 502);
  }
}
