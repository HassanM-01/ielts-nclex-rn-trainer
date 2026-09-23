import { describe, expect, it } from "vitest";
import { FIXED_SET } from "../exams/ielts-fixed-set";
import { canResume, CHECKPOINT_KEY, clearCheckpoint, loadCheckpoint, saveCheckpoint, type ExamCheckpoint } from "./checkpoint";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}

const cp = (): ExamCheckpoint => ({
  v: 1,
  id: "abc",
  exam: "ielts",
  mode: "full",
  level: 3,
  startedAt: "2026-09-23T15:00:00.000Z",
  updatedAt: "2026-09-23T15:00:00.000Z",
  items: FIXED_SET,
  examinerName: "Sonia",
  voiceURI: null,
  nextStep: 3,
  answers: [
    {
      stepId: "opening-name",
      part: 0,
      question: "Can you tell me your full name, please?",
      text: "Julio Garcia",
      askedAt: 1,
      committedAt: 2,
      outcome: "answered",
      repeats: 0,
      repeatRequests: 0,
      backupPrompt: false,
      turnIds: [4, 5],
    },
  ],
  notes: "",
  finished: false,
  endedEarly: false,
});

describe("checkpoint", () => {
  it("round-trips, dropping page-local turn ids", () => {
    const s = memoryStorage();
    expect(saveCheckpoint(cp(), s)).toBe(true);
    const back = loadCheckpoint(s);
    expect(back?.answers[0]?.text).toBe("Julio Garcia");
    expect(back?.answers[0]?.turnIds).toEqual([]);
    expect(back?.nextStep).toBe(3);
  });

  it("rejects corrupt or foreign data", () => {
    const s = memoryStorage();
    s.setItem(CHECKPOINT_KEY, "{not json");
    expect(loadCheckpoint(s)).toBeNull();
    s.setItem(CHECKPOINT_KEY, JSON.stringify({ v: 2 }));
    expect(loadCheckpoint(s)).toBeNull();
  });

  it("clears", () => {
    const s = memoryStorage();
    saveCheckpoint(cp(), s);
    clearCheckpoint(s);
    expect(loadCheckpoint(s)).toBeNull();
  });

  it("offers resume only for an unfinished exam with an answer", () => {
    expect(canResume(cp())).toBe(true);
    expect(canResume({ ...cp(), finished: true })).toBe(false);
    expect(canResume({ ...cp(), answers: [] })).toBe(false);
    expect(canResume(null)).toBe(false);
  });

  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
      removeItem: () => undefined,
    };
    expect(saveCheckpoint(cp(), broken)).toBe(false);
    expect(loadCheckpoint(broken)).toBeNull();
  });
});
