// Saving sessions (SPEC 12: "Save once at the end with retry and backoff.
// Saving never blocks the results screen"). A session is saved when the exam
// ends and again when its grade arrives; both are upserts by the session's
// uuid. Each save waits in localStorage until the server confirms it
// (SPEC 4 "Resilience"), and is retried with backoff, when the browser comes
// back online, and on the next visit to Home.

import { fluencyStats } from "../grading/fluency";
import type { MetricsSnapshot } from "../metrics/latency";
import type { ExamCheckpoint } from "../session/checkpoint";
import { DEFAULT_LEVEL } from "../levels/levels";
import type { Grade } from "../shared/grade";
import type { SaveSessionRequest } from "../shared/persistence-api";
import { api } from "./api";

const KEY = "sessions.pending.v1";
/** Waits before each retry on this page (then: next "online" or Home visit). */
const BACKOFF_MS = [2_000, 5_000, 15_000, 60_000];
const MAX_PENDING = 5;

/** Part 1 topic ids and the Part 2 card id this session used (for the repeat filter). */
export function topicIds(cp: Pick<ExamCheckpoint, "mode" | "items">): string[] {
  const part1 = cp.mode === "parts23" ? [] : cp.items.part1.map((t) => t.id);
  const part2 = cp.mode === "part1" ? [] : [cp.items.part2.id];
  return [...part1, ...part2];
}

export function buildSaveRequest(cp: ExamCheckpoint, grade: Grade | null, metrics: MetricsSnapshot): SaveSessionRequest {
  const p90 = metrics.info.pause_p90_ms;
  return {
    id: cp.id,
    startedAt: cp.startedAt,
    exam: cp.exam,
    mode: cp.mode,
    level: cp.level,
    season: cp.season ?? null,
    topicIds: topicIds(cp),
    transcript: {
      answers: cp.answers.map(({ turnIds: _t, ...a }) => a),
      notes: cp.notes,
      finished: cp.finished,
      endedEarly: cp.endedEarly,
      examinerName: cp.examinerName,
      feedbackLevel: cp.feedbackLevel ?? DEFAULT_LEVEL,
    },
    metrics: { ...metrics, fluency: fluencyStats(cp.answers.filter((a) => a.part >= 1)) },
    grade,
    pauseP90Ms: typeof p90 === "number" && Number.isFinite(p90) ? Math.round(p90) : null,
    dueWords: cp.dueWords ?? [],
  };
}

type KV = Pick<Storage, "getItem" | "setItem">;

function storage(): KV | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readPending(kv: KV | null): SaveSessionRequest[] {
  try {
    const raw = kv?.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as SaveSessionRequest[]) : [];
  } catch {
    return [];
  }
}

function writePending(kv: KV | null, list: SaveSessionRequest[]): void {
  try {
    kv?.setItem(KEY, JSON.stringify(list.slice(-MAX_PENDING)));
  } catch {
    // Storage full: the save is still attempted from memory below.
  }
}

export function pendingSaves(kv: KV | null = storage()): SaveSessionRequest[] {
  return readPending(kv);
}

let flushing: Promise<void> | null = null;
/** A save was queued while a flush was running: flush again after it. */
let dirty = false;
let attempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let onlineHooked = false;
/** Fallback when localStorage is unavailable. */
const memory = new Map<string, SaveSessionRequest>();

type Opts = { kv?: KV | null; fetchImpl?: typeof fetch };

function queued(kv: KV | null): SaveSessionRequest[] {
  const stored = readPending(kv);
  const ids = new Set(stored.map((p) => p.id));
  return [...stored, ...[...memory.values()].filter((m) => !ids.has(m.id))];
}

/** Queues a session save (replacing an older queued save of the same session) and sends it. */
export function queueSave(req: SaveSessionRequest, opts: Opts = {}): Promise<void> {
  const kv = opts.kv === undefined ? storage() : opts.kv;
  const all = queued(kv);
  const prev = all.find((p) => p.id === req.id);
  // A save that arrives without a grade never replaces one queued with it.
  const next = req.grade === null && prev?.grade ? { ...req, grade: prev.grade } : req;
  memory.set(req.id, next);
  writePending(kv, [...all.filter((p) => p.id !== req.id), next]);
  attempt = 0;
  if (flushing) dirty = true;
  return flushPending(opts);
}

/** Sends every queued save; failed ones stay queued and are retried with backoff. */
export function flushPending(opts: Opts = {}): Promise<void> {
  const kv = opts.kv === undefined ? storage() : opts.kv;
  hookOnline();
  flushing ??= (async () => {
    let failed = false;
    for (const req of queued(kv)) {
      const r = await api<{ ok: boolean }>("/api/sessions", { method: "POST", body: req, fetchImpl: opts.fetchImpl });
      // 400: the server will never accept it, so don't retry it forever.
      if (r.ok || r.status === 400) forget(kv, req);
      else failed = true;
    }
    if (failed) scheduleRetry(opts);
    else attempt = 0;
  })().finally(() => {
    flushing = null;
    if (dirty) {
      dirty = false;
      void flushPending(opts);
    }
  });
  return flushing;
}

/** Drops a sent save, unless a graded version of the same session was queued meanwhile. */
function forget(kv: KV | null, sent: SaveSessionRequest): void {
  const keep = (p: SaveSessionRequest) => p.id !== sent.id || (sent.grade === null && p.grade !== null);
  writePending(kv, readPending(kv).filter(keep));
  const m = memory.get(sent.id);
  if (m && !keep(m)) memory.delete(sent.id);
}

function scheduleRetry(opts: Opts): void {
  const wait = BACKOFF_MS[attempt];
  if (wait === undefined || retryTimer) return;
  attempt++;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushPending(opts);
  }, wait);
}

function hookOnline(): void {
  if (onlineHooked || typeof window === "undefined") return;
  onlineHooked = true;
  window.addEventListener("online", () => {
    attempt = 0;
    void flushPending();
  });
}

/** Tests only. */
export function resetSaveClient(): void {
  memory.clear();
  dirty = false;
  attempt = 0;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  flushing = null;
}
