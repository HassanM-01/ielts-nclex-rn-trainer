// 2-minute monologue test: the Part 2 case where recognizer restarts would
// most likely lose text. Restarts are marked inline where they happened.

import { Fragment, useEffect, useRef, useState } from "react";
import type { SpeechController } from "../speech/controller";
import { countWords } from "../speech/text";
import { Button, Card, fmtClock } from "./panels";
import { MONOLOGUE_START, MONOLOGUE_STOP } from "./script";

const DURATION_MS = 120_000;

interface Run {
  phase: "idle" | "intro" | "speaking" | "done";
  turnId: number | null;
  startAt: number;
  endAt: number | null;
}

const IDLE: Run = { phase: "idle", turnId: null, startAt: 0, endAt: null };

export function MonologueTest({ speech }: { speech: SpeechController }) {
  const [run, setRun] = useState<Run>(IDLE);
  const runRef = useRef(run);
  const [copied, setCopied] = useState(false);

  const update = (r: Run) => {
    runRef.current = r;
    setRun(r);
  };

  const finish = (now: number) => {
    const r = runRef.current;
    if (r.phase !== "speaking") return;
    speech.setMonologue(false);
    update({ ...r, phase: "done", endAt: now });
    void speech.say(MONOLOGUE_STOP, { interruptible: false, then: "discard" });
  };

  const start = async () => {
    if (!speech.started) void speech.start();
    update({ ...IDLE, phase: "intro" });
    await speech.say(MONOLOGUE_START, { interruptible: false });
    if (runRef.current.phase !== "intro") return;
    speech.setMonologue(true);
    update({ phase: "speaking", turnId: speech.currentTurn.id, startAt: performance.now(), endAt: null });
  };

  useEffect(
    () =>
      speech.onTick((now) => {
        const r = runRef.current;
        if (r.phase === "speaking" && now - r.startAt >= DURATION_MS) finish(now);
      }),
    // finish only touches refs and stable setters.
    [speech],
  );

  const now = performance.now();
  const segs = run.turnId !== null ? speech.buffer.segments(run.turnId) : [];
  const text = run.turnId !== null ? speech.turnText(run.turnId) : "";
  const finalText = run.turnId !== null ? speech.buffer.text(run.turnId) : "";
  const interim = text.slice(finalText.length).trim();
  const windowEnd = run.endAt ?? now;
  const restarts = run.phase === "idle" ? [] : speech.restarts.filter((r) => r.at >= run.startAt && r.at <= windowEnd + 3_000);
  const pauses = run.turnId !== null ? speech.pauses.filter((p) => p.turnId === run.turnId) : [];
  const promoted = segs.filter((s) => s.promoted).length;
  const gaps = restarts.map((r) => r.gapMs).filter((g): g is number => g !== null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card
      title="2-minute monologue test"
      hint="Read a news article aloud for the full 2 minutes, then compare this transcript with the article. ⟲ marks a recognizer restart (the 45–60 s mark is where they usually land)."
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {run.phase === "speaking" ? (
          <Button onClick={() => finish(performance.now())}>Stop early</Button>
        ) : (
          <Button primary onClick={() => void start()} disabled={run.phase === "intro"}>
            {run.phase === "done" ? "Run again" : "Start monologue"}
          </Button>
        )}
        {run.phase === "speaking" && <span className="font-mono text-lg">{fmtClock(DURATION_MS - (now - run.startAt))}</span>}
        {run.phase !== "idle" && (
          <Button onClick={() => void copy()} disabled={!text}>
            {copied ? "Copied" : "Copy transcript"}
          </Button>
        )}
      </div>

      {run.phase !== "idle" && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="words" value={countWords(text)} />
            <Stat label="restarts" value={restarts.length} />
            <Stat label="restart gap max" value={gaps.length ? `${Math.round(Math.max(...gaps))} ms` : "–"} />
            <Stat label="promoted interims" value={promoted} />
            <Stat label="pauses > 1 s" value={pauses.filter((p) => p.ms > 1_000).length} />
            <Stat label="pauses > 2 s" value={pauses.filter((p) => p.ms > 2_000).length} />
            <Stat label="speaking time" value={fmtClock(windowEnd - run.startAt)} />
          </div>
          <p className="max-h-80 overflow-auto rounded bg-slate-50 p-3 text-sm leading-relaxed">
            {segs.map((seg, i) => {
              const prev = segs[i - 1];
              const r = prev && prev.session !== seg.session ? speech.restarts.find((x) => x.endedSession === prev.session) : null;
              return (
                <Fragment key={i}>
                  {r && (
                    <span className="mx-1 rounded bg-amber-100 px-1 text-xs text-amber-800">
                      ⟲ {fmtClock(r.at - run.startAt)} {r.reason}
                      {r.gapMs !== null ? `, gap ${Math.round(r.gapMs)} ms` : ""}
                    </span>
                  )}
                  <span className={seg.promoted ? "underline decoration-dotted" : undefined} title={seg.promoted ? "promoted from interim at session end" : undefined}>
                    {seg.text}
                  </span>{" "}
                </Fragment>
              );
            })}
            {interim && <span className="text-slate-400 italic">{interim}</span>}
          </p>
        </>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-slate-200 p-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}
