// GET /api/history (SPEC 12): the list of sessions with their bands, or one
// session in full with ?id=<uuid>. Passphrase header.

import type { HistoryRow, HistorySession } from "../src/shared/persistence-api";
import { passphraseOk } from "./_lib/auth.js";
import { dbConfigured, eq, select } from "./_lib/db.js";
import { error, json } from "./_lib/http.js";
import { isUuid } from "./_lib/persistence.js";

interface Row {
  id: string;
  started_at: string;
  exam: HistoryRow["exam"];
  mode: string;
  level: HistoryRow["level"];
  overall: number | string | null;
  fc: number | null;
  lr: number | null;
  gr: number | null;
}

const LIST = "id,started_at,exam,mode,level,overall,fc:grade->fluency_coherence->band,lr:grade->lexical_resource->band,gr:grade->grammatical_range->band";
const MAX_ROWS = 300;

export function toHistoryRow(r: Row): HistoryRow {
  return {
    id: r.id,
    startedAt: r.started_at,
    exam: r.exam,
    mode: r.mode,
    level: r.level,
    overall: r.overall === null ? null : Number(r.overall),
    bands: r.fc !== null && r.lr !== null && r.gr !== null ? { fc: Number(r.fc), lr: Number(r.lr), gr: Number(r.gr) } : null,
  };
}

export async function GET(request: Request): Promise<Response> {
  if (!passphraseOk(request)) return error("unauthorized", 401);
  if (!dbConfigured()) return error("not-configured", 500);
  const id = new URL(request.url).searchParams.get("id");
  try {
    if (id !== null) {
      if (!isUuid(id)) return error("bad-request", 400);
      const rows = await select<Row & Pick<HistorySession, "transcript" | "grade">>("sessions", `select=${LIST},transcript,grade&id=${eq(id)}`);
      const r = rows[0];
      if (!r) return error("not-found", 404);
      const out: HistorySession = { ...toHistoryRow(r), transcript: r.transcript, grade: r.grade };
      return json(out);
    }
    const rows = await select<Row>("sessions", `select=${LIST}&order=started_at.desc&limit=${MAX_ROWS}`);
    return json(rows.map(toHistoryRow));
  } catch {
    return error("upstream", 502);
  }
}
