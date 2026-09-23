// Small response helpers shared by the server functions.

import type { ApiErrorCode } from "../../src/shared/examiner-api";

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export function error(code: ApiErrorCode, status: number): Response {
  return json({ error: code }, status);
}

/** Parses a JSON body, or returns null. */
export async function readJson(request: Request, maxBytes = 64_000): Promise<unknown> {
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
