// Examiner/candidate loop for measuring "answer committed -> examiner audio"
// and trying barge-in. Commit is a fixed 2.5 s of silence or the spacebar;
// real endpointing is step 2.

import { useEffect, useRef, useState } from "react";
import type { SpeechController, SayOptions } from "../speech/controller";
import { countWords } from "../speech/text";
import { Button, Card } from "./panels";
import { CLOSING, LONG_LINE, opening, QUESTIONS } from "./script";

const COMMIT_SILENCE_MS = 2_500;

type Phase = "idle" | "examiner" | "listening" | "done";

interface Row {
  q: string;
  turnId: number | null;
  bargedIn: boolean;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function ConversationTest({ speech }: { speech: SpeechController }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<Row[]>([]);
  const [longLineResult, setLongLineResult] = useState<string | null>(null);
  const ref = useRef({ phase: "idle" as Phase, index: 0, turnId: null as number | null });

  const go = (p: Phase) => {
    ref.current.phase = p;
    setPhase(p);
  };

  const ask = async (text: string, opts: SayOptions, last = false) => {
    go("examiner");
    const r = await speech.say(text, opts);
    if (ref.current.phase !== "examiner") return; // stopped meanwhile
    if (last) {
      go("done");
      return;
    }
    const turnId = speech.currentTurn.id;
    ref.current.turnId = turnId;
    setRows((prev) => prev.map((row, i) => (i === prev.length - 1 ? { ...row, turnId, bargedIn: r.bargedIn } : row)));
    go("listening");
  };

  const commit = (now: number) => {
    const s = ref.current;
    if (s.phase !== "listening") return;
    s.index++;
    const q = QUESTIONS[s.index];
    if (!q) {
      void ask(CLOSING, { commitAt: now, source: "scripted", then: "discard" }, true);
      return;
    }
    setRows((prev) => [...prev, { q, turnId: null, bargedIn: false }]);
    void ask(q, { commitAt: now, source: "scripted" });
  };

  const start = () => {
    const clickAt = performance.now();
    if (!speech.started) void speech.start();
    ref.current.index = 0;
    const first = QUESTIONS[0] ?? "";
    setRows([{ q: first, turnId: null, bargedIn: false }]);
    void ask(`${opening(speech.examiner.name)} ${first}`, { clickAt });
  };

  const stop = () => {
    go("idle");
    speech.cancelSpeech();
  };

  const sayLong = async () => {
    setLongLineResult(null);
    if (!speech.started) void speech.start();
    const r = await speech.say(LONG_LINE);
    setLongLineResult(r.bargedIn ? "barge-in: examiner stopped and your speech became your turn" : r.cancelled ? "cancelled" : "finished without barge-in");
  };

  useEffect(() => {
    const unTick = speech.onTick((now) => {
      const s = ref.current;
      if (s.phase !== "listening" || s.turnId === null) return;
      const hasSpeech = countWords(speech.turnText(s.turnId)) > 0;
      if (hasSpeech && speech.silenceMs(now) >= COMMIT_SILENCE_MS) commit(now);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || ref.current.phase !== "listening" || isTyping(e.target)) return;
      e.preventDefault();
      commit(performance.now());
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      unTick();
      window.removeEventListener("keydown", onKey, true);
    };
    // commit/ask only touch refs and stable setters, so [speech] is enough.
  }, [speech]);

  const now = performance.now();
  const listeningTurn = ref.current.turnId;
  const silence = phase === "listening" && listeningTurn !== null && speech.turnText(listeningTurn) ? speech.silenceMs(now) : 0;

  return (
    <Card
      title="Conversation test"
      hint="The examiner asks 6 short questions. Answer normally; 2.5 s of silence (or the spacebar) commits your answer. Measures click → speaking and commit → examiner audio. With headphones on, talk over the examiner to test barge-in."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {phase === "idle" || phase === "done" ? (
          <Button primary onClick={start}>
            Start conversation
          </Button>
        ) : (
          <Button onClick={stop}>Stop</Button>
        )}
        <Button onClick={() => void sayLong()} disabled={phase === "examiner" || phase === "listening"}>
          Examiner reads a long line
        </Button>
        <span className="text-sm text-slate-500">
          {phase}
          {phase === "listening" && ` · commit in ${Math.max(0, (COMMIT_SILENCE_MS - silence) / 1000).toFixed(1)} s of silence (or Space)`}
        </span>
      </div>
      {longLineResult && <p className="mb-2 text-sm text-slate-600">Long line: {longLineResult}</p>}
      <ol className="space-y-2 text-sm">
        {rows.map((row, i) => (
          <li key={i}>
            <div className="text-sky-700">{row.q}</div>
            <div className="ml-4">
              {row.turnId !== null ? speech.turnText(row.turnId) || <span className="text-slate-300">…</span> : null}
              {row.bargedIn && <span className="ml-2 text-xs text-amber-700">(barge-in)</span>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
