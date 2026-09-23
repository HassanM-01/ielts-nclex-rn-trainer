// Windows communications ducking check (SPEC 6, "Lab page"): the examiner
// starts with the mic closed, then the VAD stream opens (at 4 s) and the
// recognizer starts (at 10 s). If the voice gets quieter at either moment,
// the mic is triggering ducking.

import { useEffect, useRef, useState } from "react";
import type { SpeechController } from "../speech/controller";
import { Button, Card } from "./panels";
import { DUCKING_PASSAGE } from "./script";

const VAD_AT_MS = 4_000;
const RECOGNIZER_AT_MS = 10_000;

export function DuckingTest({ speech }: { speech: SpeechController }) {
  const [running, setRunning] = useState(false);
  const [marks, setMarks] = useState<{ t: number; label: string }[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const t0 = useRef(0);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const mark = (label: string) => setMarks((m) => [...m, { t: performance.now() - t0.current, label }]);

  const run = async () => {
    timers.current.forEach(clearTimeout);
    speech.stop(); // mic closed
    setMarks([]);
    setRunning(true);
    t0.current = performance.now();
    const ec = speech.vadOptions.echoCancellation;
    mark("Examiner starts, mic closed");
    timers.current = [
      setTimeout(() => {
        void speech.openVad().then(() => mark(`Mic stream opened (echoCancellation ${ec ? "on" : "off"})`));
      }, VAD_AT_MS),
      setTimeout(() => {
        speech.startRecognizer();
        mark("Recognizer started");
      }, RECOGNIZER_AT_MS),
    ];
    await speech.say(DUCKING_PASSAGE, { then: "discard" });
    mark("Examiner finished");
    setRunning(false);
  };

  return (
    <Card
      title="Volume (ducking) test"
      hint="Listen to the examiner's volume. At 4 s the mic stream opens; at 10 s speech recognition starts. Report whether the voice got quieter, and at which step. If it did, untick 'VAD stream echoCancellation' in Settings and run it again; if it still drops, try Windows Sound > Communications > 'Do nothing'."
    >
      <div className="mb-3">
        <Button primary onClick={() => void run()} disabled={running}>
          {running ? "Running…" : "Run volume test"}
        </Button>
      </div>
      <ul className="font-mono text-sm">
        {marks.map((m, i) => (
          <li key={i}>
            {(m.t / 1000).toFixed(1)} s · {m.label}
          </li>
        ))}
      </ul>
    </Card>
  );
}
