// Browser calls to the passphrase routes (/api/sessions, /api/history,
// /api/vocab). The passphrase goes in a header, never in the URL.

import { PASSPHRASE_HEADER } from "../shared/persistence-api";
import { storedPassphrase } from "../session/token-client";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number | null };

const TIMEOUT_MS = 15_000;

export async function api<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown; fetchImpl?: typeof fetch } = {}): Promise<ApiResult<T>> {
  const pass = storedPassphrase();
  if (!pass) return { ok: false, status: 401 };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await (init.fetchImpl ?? fetch)(path, {
      method: init.method ?? "GET",
      headers: { "content-type": "application/json", [PASSPHRASE_HEADER]: pass },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: null };
  } finally {
    clearTimeout(timer);
  }
}
