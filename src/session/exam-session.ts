// Creates and holds the running exam. Step 2 uses the fixed set at Nivel 3
// ("Examen completo" conditions); step 4 replaces the items with the ones
// /api/session-start selects.

import { useFrameSubscription } from "../app/speech";
import { FIXED_SET } from "../exams/ielts-fixed-set";
import { buildIeltsScript, IELTS_ENDPOINTING } from "../exams/ielts";
import { conditionsLevel, DEFAULT_LEVEL } from "../levels/levels";
import type { SpeechController } from "../speech/controller";
import { newSessionId, saveCheckpoint, type ExamCheckpoint } from "./checkpoint";
import { ExamEngine } from "./engine";
import { ExaminerClient } from "./examiner-client";
import { getToken } from "./token-client";

const FALLBACK_EXAMINER_NAME = "Alex";

let active: ExamEngine | null = null;

export function getActiveExam(): ExamEngine | null {
  return active;
}

/** "Empezar examen". Call from the click handler (it unlocks audio). */
export function startNewExam(speech: SpeechController, clickAt: number): ExamEngine {
  const mode = "full" as const;
  const now = new Date().toISOString();
  const cp: ExamCheckpoint = {
    v: 1,
    id: newSessionId(),
    exam: "ielts",
    mode,
    level: conditionsLevel(mode, DEFAULT_LEVEL),
    startedAt: now,
    updatedAt: now,
    items: FIXED_SET,
    examinerName: speech.examiner.name || FALLBACK_EXAMINER_NAME,
    voiceURI: speech.synth.voice?.voiceURI ?? null,
    nextStep: 0,
    answers: [],
    notes: "",
    finished: false,
    endedEarly: false,
  };
  return launch(speech, cp, clickAt);
}

/** "Continuar examen" after a reload. Same examiner voice, next unanswered step. */
export function resumeExam(speech: SpeechController, cp: ExamCheckpoint, clickAt: number): ExamEngine {
  speech.useSessionVoice(cp.voiceURI);
  return launch(speech, cp, clickAt);
}

function launch(speech: SpeechController, cp: ExamCheckpoint, clickAt: number): ExamEngine {
  active?.dispose();
  const steps = buildIeltsScript(cp.items, {
    examinerName: cp.examinerName,
    level: cp.level,
    hour: new Date(cp.startedAt).getHours(),
  });
  const engine = new ExamEngine(speech, steps, cp, {
    level: cp.level,
    defaults: IELTS_ENDPOINTING,
    save: (c) => void saveCheckpoint(c),
    // One client per exam: its guard counts the 40-request session cap.
    examiner: new ExaminerClient(() => getToken()),
  });
  active = engine;
  saveCheckpoint(cp);
  engine.start(clickAt);
  return engine;
}

/** Re-render on engine changes, at most once per frame. */
export function useExam(engine: ExamEngine | null): void {
  useFrameSubscription(engine ? engine.subscribeBound : null);
}
