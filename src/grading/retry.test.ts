import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SayOptions, SayResult, Turn, TurnKind } from "../speech/controller";
import { saveWord, isSaved, loadSavedWords, syncWords } from "./vocab-store";

vi.mock("../session/token-client", () => ({ getToken: vi.fn(async () => "tok"), storedPassphrase: () => "pass" }));

const { RetryAttempt, compareAttempts, resetCompareCap, retryRules } = await import("./retry");

class FakeSpeech {
  started = false;
  stopped = 0;
  canHear = true;
  silence = 0;
  said: string[] = [];
  turns: Turn[] = [];
  texts = new Map<number, string>();
  private seq = 0;
  private ticks = new Set<(now: number) => void>();

  get currentTurn(): Turn {
    return this.turns[this.turns.length - 1] ?? { id: 0, kind: "discard", startedAt: 0, line: "" };
  }
  async start(): Promise<void> {
    this.started = true;
  }
  stop(): void {
    this.stopped++;
    this.started = false;
  }
  say(text: string, _opts?: SayOptions): Promise<SayResult> {
    this.said.push(text);
    this.newTurn("examiner", text);
    return Promise.resolve().then(() => {
      this.newTurn("candidate", text);
      return { cancelled: false, fellBack: false, watchdogs: 0, skipped: 0, bargedIn: false };
    });
  }
  cancelSpeech(): void {}
  newTurn(kind: TurnKind, line = ""): Turn {
    const t = { id: ++this.seq, kind, startedAt: 0, line };
    this.turns.push(t);
    return t;
  }
  turnText(id: number): string {
    return this.texts.get(id) ?? "";
  }
  silenceMs(): number {
    return this.silence;
  }
  voicedRecently(): boolean {
    return false;
  }
  onTick(fn: (now: number) => void): () => void {
    this.ticks.add(fn);
    return () => this.ticks.delete(fn);
  }
  tick(now: number): void {
    for (const fn of this.ticks) fn(now);
  }
  reply(text: string): void {
    this.texts.set(this.currentTurn.id, text);
  }
}

let clock = 0;
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(() => {
  clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  resetCompareCap();
});
afterEach(() => vi.restoreAllMocks());

describe("RetryAttempt (Reintentar)", () => {
  it("re-asks the question, endpoints his answer and releases the mic", async () => {
    const speech = new FakeSpeech();
    const attempt = new RetryAttempt(speech as never, "Do you work or are you a student?", 1);
    const done = attempt.run();
    await flush();
    expect(speech.started).toBe(true);
    expect(speech.said).toEqual(["Do you work or are you a student?"]);
    expect(attempt.phase).toBe("listening");
    speech.reply("I work as a nurse in a big hospital downtown");
    clock = 1_000;
    speech.tick(clock);
    clock = 5_000;
    speech.silence = 3_000;
    speech.tick(clock);
    expect(await done).toBe("I work as a nurse in a big hospital downtown");
    expect(speech.stopped).toBe(1);
  });

  it("repeats once on 'Sorry?' and keeps the request out of the answer", async () => {
    const speech = new FakeSpeech();
    const attempt = new RetryAttempt(speech as never, "Why?", 3);
    const done = attempt.run();
    await flush();
    speech.reply("sorry");
    clock = 1_000;
    speech.tick(clock);
    clock = 6_000;
    speech.silence = 4_000;
    speech.tick(clock);
    await flush();
    expect(speech.said).toEqual(["Why?", "Why?"]);
    speech.reply("because people need rest after work");
    attempt.commitNow();
    expect(await done).toBe("because people need rest after work");
  });

  it("gives Part 2 the long-turn silence and the 2-minute limit", () => {
    expect(retryRules(2)).toEqual({ baseSilenceMs: 6_000, maxAnswerMs: 120_000 });
    expect(retryRules(1).baseSilenceMs).toBe(2_500);
    expect(retryRules(3).baseSilenceMs).toBe(3_500);
  });
});

describe("compareAttempts", () => {
  const body = { question: "Why?", first: "because", second: "because it is calm", better: "Because it is calm." };

  it("posts kind compare to /api/examiner and returns the two lines", async () => {
    const fetchImpl = vi.fn(async () => new Response("Mejoraste.\nAhora prueba…"));
    expect(await compareAttempts(body, fetchImpl)).toEqual({ ok: true, text: "Mejoraste.\nAhora prueba…" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/examiner");
    expect(JSON.parse(init.body as string)).toEqual({ kind: "compare", ...body });
  });

  it("fails softly and stops after the client cap", async () => {
    expect(await compareAttempts(body, vi.fn(async () => new Response("", { status: 500 })))).toEqual({ ok: false });
    const fetchImpl = vi.fn(async () => new Response("ok"));
    for (let i = 0; i < 12; i++) await compareAttempts(body, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(9);
  });
});

describe("vocab store (Guardar)", () => {
  it("saves each word once, case-insensitively", () => {
    const store = new Map<string, string>();
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const item = { word: "Triage", es: "clasificación", example: "Triage comes first.", exam: "both" as const, nclex_area: "Management of Care" as const };
    const down = vi.fn(async () => new Response("{}", { status: 503 }));
    expect(saveWord(item, "s1", kv, down)).toBe(true);
    expect(saveWord({ ...item, word: "triage" }, "s2", kv, down)).toBe(true);
    expect(loadSavedWords(kv)).toHaveLength(1);
    expect(isSaved("TRIAGE", kv)).toBe(true);
    expect(isSaved("shift", kv)).toBe(false);
    expect(saveWord(item, "s1", null)).toBe(false);
  });

  it("sends unsynced words to /api/vocab (including step 5's), then marks them synced", async () => {
    const store = new Map<string, string>();
    const kv = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const sid = "3f2c1a9e-8b7d-4c6e-9f10-1a2b3c4d5e6f";
    // A word saved in step 5 has no "synced" flag.
    kv.setItem("vocab.saved.v1", JSON.stringify([{ word: "hectic", es: "ajetreado", example: "", exam: "ielts", nclex_area: "none", sessionId: sid, savedAt: "t" }]));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    await syncWords(kv, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/vocab");
    expect(JSON.parse(init.body as string)).toEqual({ action: "save", sessionId: sid, items: [{ word: "hectic", es: "ajetreado", example: "", exam: "ielts", nclex_area: "none" }] });
    expect(loadSavedWords(kv)[0]?.synced).toBe(true);
    await syncWords(kv, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
