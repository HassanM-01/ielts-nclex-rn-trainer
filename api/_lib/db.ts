// Supabase from the server functions only (SPEC 4): plain fetch to its REST
// API with the secret key, which maps to the service_role role. No
// supabase-js: nothing here can reach the browser bundle, and cold starts
// stay light. Every call has a timeout; callers decide what a failure means
// (SPEC 4: "the app keeps working if the database is down").

export class DbError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

interface DbConfig {
  url: string;
  key: string;
}

function config(): DbConfig | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url, key } : null;
}

export function dbConfigured(): boolean {
  return config() !== null;
}

async function request<T>(path: string, init: RequestInit & { timeoutMs: number }): Promise<T> {
  const cfg = config();
  if (!cfg) throw new DbError("not-configured", null);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs);
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
      ...init,
      // Secret keys go on the apikey header only (they aren't JWTs).
      headers: { apikey: cfg.key, "content-type": "application/json", ...init.headers },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new DbError(`supabase ${res.status}`, res.status);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (err) {
    if (err instanceof DbError) throw err;
    throw new DbError(ctrl.signal.aborted ? "timeout" : "network", null);
  } finally {
    clearTimeout(timer);
  }
}

/** Calls a database function (POST /rest/v1/rpc/<name>). */
export function rpc<T>(name: string, args: Record<string, unknown> = {}, timeoutMs = 3_000): Promise<T> {
  return request<T>(`rpc/${name}`, { method: "POST", body: JSON.stringify(args), timeoutMs });
}

/** Selects rows: `query` is a PostgREST query string such as "select=a,b&order=a.desc". */
export function select<T>(table: string, query: string, timeoutMs = 3_000): Promise<T[]> {
  return request<T[]>(`${table}?${query}`, { method: "GET", timeoutMs });
}

/** Inserts rows, ignoring ones whose primary key already exists. */
export function insertIgnore(table: string, rows: readonly Record<string, unknown>[], timeoutMs = 3_000): Promise<unknown> {
  return request(`${table}`, {
    method: "POST",
    body: JSON.stringify(rows),
    headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
    timeoutMs,
  });
}

/** Updates the rows matching `filter` (e.g. "word=eq.triage"). */
export function update(table: string, filter: string, values: Record<string, unknown>, timeoutMs = 3_000): Promise<unknown> {
  return request(`${table}?${filter}`, {
    method: "PATCH",
    body: JSON.stringify(values),
    headers: { prefer: "return=minimal" },
    timeoutMs,
  });
}

/** PostgREST filter value: quoted, so commas and parentheses in a word are safe. */
export function eq(value: string): string {
  return `eq.${encodeURIComponent(`"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`)}`;
}
