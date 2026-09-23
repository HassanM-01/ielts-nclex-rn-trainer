// Session token in the browser (SPEC 4, "Auth"; SPEC 3.5 prewarm). The
// passphrase is typed once and kept in localStorage; tokens are refreshed
// when older than 30 minutes (they expire after 45).

import type { SessionStartResponse } from "../shared/examiner-api";

export type LoginResult = "ok" | "wrong" | "unavailable";

const PASS_KEY = "app.passphrase.v1";
export const TOKEN_REFRESH_MS = 30 * 60 * 1000;

interface Cached {
  token: string;
  fetchedAt: number;
  expiresAt: number;
}

let cached: Cached | null = null;
let pending: Promise<LoginResult> | null = null;
let lastResult: LoginResult | null = null;

export function storedPassphrase(): string | null {
  try {
    return localStorage.getItem(PASS_KEY);
  } catch {
    return null;
  }
}

function storePassphrase(p: string): void {
  try {
    localStorage.setItem(PASS_KEY, p);
  } catch {
    // The passphrase lasts for this page only.
  }
}

/** Result of the last login attempt, for the Home screen. */
export function loginStatus(): LoginResult | null {
  return lastResult;
}

/** Sends the passphrase; on success stores it and caches a token. */
export function login(passphrase: string, fetchImpl: typeof fetch = fetch): Promise<LoginResult> {
  pending ??= (async (): Promise<LoginResult> => {
    try {
      const res = await fetchImpl("/api/session-start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (res.status === 401) return "wrong";
      if (!res.ok) return "unavailable";
      const data = (await res.json()) as SessionStartResponse;
      if (typeof data.token !== "string") return "unavailable";
      cached = { token: data.token, fetchedAt: Date.now(), expiresAt: data.expiresAt };
      storePassphrase(passphrase);
      return "ok";
    } catch {
      return "unavailable";
    }
  })().then((r) => {
    lastResult = r;
    pending = null;
    return r;
  });
  return pending;
}

/** A valid token, fetching a fresh one if needed; null if none can be had. */
export async function getToken(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < TOKEN_REFRESH_MS && cached.expiresAt - now > 60_000) return cached.token;
  const pass = storedPassphrase();
  if (!pass) return null;
  const r = await login(pass, fetchImpl);
  return r === "ok" && cached ? cached.token : null;
}

/** Tests only. */
export function resetTokenCache(): void {
  cached = null;
  pending = null;
  lastResult = null;
}
