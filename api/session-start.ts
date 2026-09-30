// POST /api/session-start (SPEC 4 "Auth", SPEC 9 "Selection"): passphrase
// -> signed session token plus the questions for this session.
//
// One database round trip (session_start_info): today's graded sessions for
// the daily cap, recent topic ids for the repeat filter, the profile row,
// saved words due for review and the last full test. If Supabase is
// unreachable this still returns a token and questions, with no cap and no
// filter (SPEC 4 "Resilience").

import type { LevelId } from "../src/levels/levels";
import type { SessionStartResponse } from "../src/shared/examiner-api";
import { dailyCap } from "./_lib/auth.js";
import { loadBank } from "./_lib/bank.js";
import { dbConfigured, rpc } from "./_lib/db.js";
import { error, json, readJson } from "./_lib/http.js";
import { selectItems } from "./_lib/select.js";
import { issueToken, safeEqual } from "./_lib/token.js";

/** The session_start_info() result (supabase/migrations/0001_init.sql). */
export interface StartInfo {
  today: number;
  recent_part1: string[];
  recent_part2: string[];
  profile: { level: number; pause_p90: number | null; ielts_test_date: string | null } | null;
  due_words: { word: string; es: string }[];
  last_full: { overall: number; started_at: string } | null;
}

/** Short: the exam's first click must never wait long for the database. */
const DB_TIMEOUT_MS = 1_500;

function parseDate(x: unknown): Date | null {
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return null;
  const d = new Date(`${x}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function startInfo(): Promise<StartInfo | null> {
  if (!dbConfigured()) return null;
  try {
    return await rpc<StartInfo>("session_start_info", {}, DB_TIMEOUT_MS);
  } catch {
    return null;
  }
}

function level(x: unknown): LevelId {
  return x === 1 || x === 3 ? x : 2;
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SESSION_SECRET;
  const passphrase = process.env.APP_PASSPHRASE;
  if (!secret || !passphrase) return error("not-configured", 500);

  const body = await readJson(request, 2_000);
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof b.passphrase !== "string" || !safeEqual(b.passphrase.trim(), passphrase)) return error("wrong-passphrase", 401);

  const info = await startInfo();
  if (info && info.today >= dailyCap()) return error("daily-cap", 429);

  const { token, payload } = issueToken(secret);
  const testDate = parseDate(b.testDate) ?? parseDate(info?.profile?.ielts_test_date);
  const selection = selectItems(loadBank(), {
    now: new Date(),
    testDate,
    recent: info ? { part1: info.recent_part1, part2: info.recent_part2 } : undefined,
  });
  const res: SessionStartResponse = {
    token,
    expiresAt: payload.exp,
    items: selection?.items ?? null,
    season: selection?.season ?? null,
    profile: info?.profile
      ? { level: level(info.profile.level), pauseP90Ms: info.profile.pause_p90, testDate: info.profile.ielts_test_date }
      : null,
    dueWords: info?.due_words ?? [],
    lastFull: info?.last_full ? { overall: Number(info.last_full.overall), startedAt: info.last_full.started_at } : null,
  };
  return json(res);
}
