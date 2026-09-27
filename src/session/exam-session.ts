// Creates and holds the running exam. Questions come from
// /api/session-start (step 4), or the fixed set offline. Grading starts as
// the closing line begins (SPEC 11), and the Part 2 long turn is recorded
// in memory for replay (SPEC 13).

import { useFrameSubscription } from "../app/speech";
import { FIXED_SET } from "../exams/ielts-fixed-set";
import { buildIeltsScript, IELTS_ENDPOINTING, type ScriptMode } from "../exams/ielts";
import { currentGradeJob, startGrading, subscribeGrade } from "../grading/grade-client";
import { startPart2Recording, stopPart2Recording } from "../grading/part2-audio";
import { conditionsLevel, DEFAULT_LEVEL } from "../levels/levels";
import type { SpeechController } from "../speech/controller";
import { newSessionId, saveCheckpoint, type ExamCheckpoint } from "./checkpoint";
import { ExamEngine } from "./engine";
import { ExaminerClient } from "./examiner-client";
import { getToken, takePreparedItems } from "./token-client";

const FALLBACK_EXAMINER_NAME = "Alex";

let active: ExamEngine | null = null;

export function getActiveExam(): ExamEngine | null {
  return active;
}

/**
 * "Empezar examen". Call from the click handler (it unlocks audio). Uses the
 * questions /api/session-start prepared on Home, or the fixed set offline.
 */
export function startNewExam(speech: SpeechController, clickAt: number, mode: ScriptMode = "full"): ExamEngine {
  const prepared = takePreparedItems();
  const now = new Date().toISOString();
  const cp: ExamCheckpoint = {
    v: 1,
    id: newSessionId(),
    exam: "ielts",
    mode,
    level: conditionsLevel(mode, DEFAULT_LEVEL),
    // Placement arrives in step 7; until then feedback aims at Nivel 2.
    feedbackLevel: DEFAULT_LEVEL,
    startedAt: now,
    updatedAt: now,
    items: prepared?.items ?? FIXED_SET,
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

function scriptMode(mode: ExamCheckpoint["mode"]): ScriptMode {
  return mode === "part1" || mode === "parts23" ? mode : "full";
}

function launch(speech: SpeechController, cp: ExamCheckpoint, clickAt: number): ExamEngine {
  active?.dispose();
  const steps = buildIeltsScript(cp.items, {
    examinerName: cp.examinerName,
    level: cp.level,
    hour: new Date(cp.startedAt).getHours(),
    mode: scriptMode(cp.mode),
  });
  const engine = new ExamEngine(speech, steps, cp, {
    level: cp.level,
    defaults: IELTS_ENDPOINTING,
    save: (c) => void saveCheckpoint(c),
    // One client per exam: its guard counts the 40-request session cap.
    examiner: new ExaminerClient(() => getToken()),
    onClosing: () => beginGrading(speech, cp, true, () => engine.endedAt),
    // "Terminar" skips the closing line: grade what exists.
    onFinish: () => beginGrading(speech, cp, false, () => engine.endedAt),
    onMonologue: (on) => (on ? startPart2Recording(cp.id, speech.vad?.stream) : stopPart2Recording()),
  });
  active = engine;
  saveCheckpoint(cp);
  engine.start(clickAt);
  return engine;
}

/**
 * Starts grading once per session: at the closing line, or at the end if
 * "Terminar" skipped it. A second call is a no-op, even after a failure
 * (the results screen offers "Intentar de nuevo").
 */
function beginGrading(speech: SpeechController, cp: ExamCheckpoint, reachedClosing: boolean, examEndedAt: () => number | null): void {
  if (currentGradeJob(cp.id)) return;
  const job = startGrading(cp, speech.recognizer.avgConfidence, { reachedClosing });
  speech.metrics.log("grade-start", `${cp.mode}: ${job.status}`);
  watchGradeJob(speech, cp.id, examEndedAt);
}

/**
 * Logs how the current grading job went ("grade-done" with timings and
 * tokens, or "grade-error") and, for an exam that just ended, records
 * "exam end → first band". Done here rather than by the results screen, so
 * a background tab (which doesn't render) still gets its numbers.
 */
export function watchGradeJob(speech: SpeechController, sessionId: string, examEndedAt: () => number | null = () => null): void {
  const job = currentGradeJob(sessionId);
  if (!job || job.status !== "streaming") return;
  const m = speech.metrics;
  let bandRecorded = false;
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const check = () => {
    const j = currentGradeJob(sessionId);
    if (j !== job) return unsub();
    const ended = examEndedAt();
    if (!bandRecorded && j.firstBandAt !== null && ended !== null) {
      bandRecorded = true;
      m.record("grade_first_band", Math.max(0, j.firstBandAt - ended));
    }
    if (j.status === "streaming") return;
    if (j.status === "done") {
      const u = j.usage ? `, ${j.usage.input} input / ${j.usage.output} output tokens` : "";
      m.log("grade-done", `first band ${secs((j.firstBandAt ?? j.startedAt) - j.startedAt)} after the request, all ${secs((j.endedAt ?? j.startedAt) - j.startedAt)}${u}`);
    } else {
      m.log("grade-error", j.failure ?? "?");
    }
    unsub();
  };
  const unsub = subscribeGrade(check);
}

/** Re-render on engine changes, at most once per frame. */
export function useExam(engine: ExamEngine | null): void {
  useFrameSubscription(engine ? engine.subscribeBound : null);
}
