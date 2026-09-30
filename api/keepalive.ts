// GET /api/keepalive: a daily Vercel Cron job (vercel.json) that updates the
// heartbeat row, because free Supabase projects pause after 7 days of low
// activity (SPEC 4). Vercel sends "Authorization: Bearer <CRON_SECRET>".

import { dbConfigured, rpc } from "./_lib/db.js";
import { error, json } from "./_lib/http.js";
import { bearer, safeEqual } from "./_lib/token.js";

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !dbConfigured()) return error("not-configured", 500);
  const given = bearer(request);
  if (!given || !safeEqual(given, secret)) return error("unauthorized", 401);
  try {
    const beatAt = await rpc<string>("keepalive", {}, 5_000);
    return json({ ok: true, beatAt });
  } catch {
    return error("upstream", 502);
  }
}
