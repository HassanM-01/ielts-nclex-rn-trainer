// Latency and speech telemetry. Kept in memory during a session; its
// snapshot() is the shape that goes into sessions.metrics (step 6). The lab
// also persists it to localStorage so numbers survive a reload.

import { budgetStatus, summarize, type BudgetStatus, type Summary } from "./stats";

export type LatencyName =
  | "click_to_speaking"
  | "commit_to_audio_scripted"
  | "commit_to_audio_ai"
  | "tts_start"
  | "tts_sentence_gap"
  | "rec_restart_gap"
  | "rec_first_interim"
  | "rec_final_lag";

/** SPEC 3 performance budget (ms). */
export const BUDGET: Partial<Record<LatencyName, { target: number; limit: number }>> = {
  commit_to_audio_scripted: { target: 400, limit: 800 },
  commit_to_audio_ai: { target: 700, limit: 1_200 },
  click_to_speaking: { target: 500, limit: 1_000 },
};

export const LATENCY_LABELS: Record<LatencyName, string> = {
  click_to_speaking: "Click → examiner speaking",
  commit_to_audio_scripted: "Commit → examiner audio (scripted)",
  commit_to_audio_ai: "Commit → examiner audio (Part 3 AI)",
  tts_start: "speak() → voice start (per sentence)",
  tts_sentence_gap: "Gap between examiner sentences",
  rec_restart_gap: "Recognizer restart gap (end → start)",
  rec_first_interim: "Voice onset → first interim text",
  rec_final_lag: "Voice end → final text",
};

export interface LogEvent {
  /** performance.now() on the page that logged it. */
  t: number;
  /** Wall clock (epoch ms), so events from earlier page loads still read right. */
  at: number;
  type: string;
  detail?: string;
}

export type InfoValue = string | number | boolean | null;

export interface MetricsSnapshot {
  latency: Partial<Record<LatencyName, number[]>>;
  counters: Record<string, number>;
  info: Record<string, InfoValue>;
  events: LogEvent[];
}

export interface LatencyRow extends Summary {
  name: LatencyName;
  label: string;
  target: number | null;
  limit: number | null;
  status: BudgetStatus;
}

const MAX_EVENTS = 200;
/** Events worth pasting into a checkpoint report. */
const NOTABLE_EVENTS = new Set([
  "stall", "rec-error", "rec-failure", "mic-change", "tts-fallback", "tts-watchdog", "tts-stuck", "vad",
  "barge-in", "carry", "echo-trim", "commit", "repeat-request", "no-speech-repeat", "no-answer", "time-limit",
  "backup-prompt", "hard-stop",
]);
const REPORT_EVENTS = 80;
const MAX_SAMPLES = 500;

export class Metrics {
  private latency = new Map<LatencyName, number[]>();
  private counters = new Map<string, number>();
  private info = new Map<string, InfoValue>();
  private events: LogEvent[] = [];
  private listeners = new Set<() => void>();
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly storageKey: string | null = null) {
    this.load();
  }

  record(name: LatencyName, ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    const list = this.latency.get(name) ?? [];
    list.push(Math.round(ms));
    if (list.length > MAX_SAMPLES) list.shift();
    this.latency.set(name, list);
    this.changed();
  }

  count(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
    this.changed();
  }

  setInfo(key: string, value: InfoValue): void {
    this.info.set(key, value);
    this.changed();
  }

  log(type: string, detail?: string): void {
    this.events.push({ t: Math.round(performance.now()), at: Date.now(), type, detail });
    if (this.events.length > MAX_EVENTS) this.events.shift();
    this.changed();
  }

  rows(): LatencyRow[] {
    return (Object.keys(LATENCY_LABELS) as LatencyName[]).map((name) => {
      const s = summarize(this.latency.get(name) ?? []);
      const b = BUDGET[name];
      return {
        name,
        label: LATENCY_LABELS[name],
        ...s,
        target: b?.target ?? null,
        limit: b?.limit ?? null,
        status: b ? budgetStatus(s, b.target, b.limit) : "none",
      };
    });
  }

  getCounters(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  getInfo(): Record<string, InfoValue> {
    return Object.fromEntries(this.info);
  }

  getEvents(): readonly LogEvent[] {
    return this.events;
  }

  snapshot(): MetricsSnapshot {
    return {
      latency: Object.fromEntries(this.latency),
      counters: this.getCounters(),
      info: this.getInfo(),
      events: [...this.events],
    };
  }

  /** Plain-text report Hassan can paste into a checkpoint result. */
  report(): string {
    const lines: string[] = ["Latency (ms): n / p50 / p95 [target / limit]"];
    for (const r of this.rows()) {
      if (r.n === 0 && r.target === null) continue;
      const budget = r.target !== null ? ` [${r.target} / ${r.limit}] ${r.status}` : "";
      lines.push(`- ${r.label}: ${r.n} / ${r.p50 ?? "-"} / ${r.p95 ?? "-"}${budget}`);
    }
    lines.push("Counters:");
    for (const [k, v] of this.counters) lines.push(`- ${k}: ${v}`);
    lines.push("Info:");
    for (const [k, v] of this.info) lines.push(`- ${k}: ${String(v)}`);
    const notable = this.events.filter((e) => NOTABLE_EVENTS.has(e.type)).slice(-REPORT_EVENTS);
    if (notable.length) {
      lines.push("Notable events (local time):");
      for (const e of notable) {
        const time = new Date(e.at).toLocaleTimeString("en-GB", { hour12: false });
        lines.push(`- ${time} ${e.type}${e.detail ? `: ${e.detail}` : ""}`);
      }
    }
    return lines.join("\n");
  }

  reset(): void {
    this.latency.clear();
    this.counters.clear();
    this.events = [];
    this.changed();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
    if (this.storageKey && !this.persistTimer) {
      this.persistTimer = setTimeout(() => {
        this.persistTimer = null;
        this.persist();
      }, 1_000);
    }
  }

  private persist(): void {
    if (!this.storageKey) return;
    try {
      const { latency, counters, events } = this.snapshot();
      localStorage.setItem(this.storageKey, JSON.stringify({ latency, counters, events }));
    } catch {
      // Storage full or blocked: metrics stay in memory.
    }
  }

  private load(): void {
    if (!this.storageKey || typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<Pick<MetricsSnapshot, "latency" | "counters" | "events">>;
      for (const [k, v] of Object.entries(data.latency ?? {})) {
        if (k in LATENCY_LABELS && Array.isArray(v)) this.latency.set(k as LatencyName, v.filter((x) => typeof x === "number"));
      }
      for (const [k, v] of Object.entries(data.counters ?? {})) {
        if (typeof v === "number") this.counters.set(k, v);
      }
      if (Array.isArray(data.events)) {
        this.events = data.events
          .filter((e): e is LogEvent => !!e && typeof e.type === "string" && typeof e.at === "number")
          .slice(-MAX_EVENTS);
      }
    } catch {
      // Corrupt entry: start fresh.
    }
  }
}
