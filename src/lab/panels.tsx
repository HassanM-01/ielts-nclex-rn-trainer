// Lab building blocks: status bar, settings, voice picker, live transcript,
// event log. Developer tool, so English.

import type { ReactNode } from "react";
import { MicMeter } from "../components/MicMeter";
import type { SpeechController, Turn } from "../speech/controller";
import { ACCENTS, rankVoice, type Accent } from "../speech/voices";

export function Card({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint && <p className="mb-3 text-sm text-slate-500">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  );
}

export function Button({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 ${
        primary ? "bg-slate-800 text-white" : "border border-slate-300 bg-white"
      }`}
    >
      {children}
    </button>
  );
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function StatusBar({ speech }: { speech: SpeechController }) {
  const now = performance.now();
  const rec = speech.recognizer;
  const turn = speech.currentTurn;
  const state = speech.examinerSpeaking ? "speaking" : rec.isCapturing && turn.kind === "candidate" ? "listening" : "idle";
  const pill = { speaking: "bg-sky-600", listening: "bg-emerald-600", idle: "bg-slate-400" }[state];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span className={`rounded-full px-3 py-1 font-medium text-white ${pill}`}>{state}</span>
      <span>
        recognizer: <b>{rec.state}</b> ({rec.mode}), session {rec.session}, age {(rec.sessionAge(now) / 1000).toFixed(0)} s
      </span>
      <span>
        turn #{turn.id} <b>{turn.kind}</b>
      </span>
      <span>headphones: <b>{speech.prefs.headphones ? "on" : "off"}</b></span>
      <span>
        VAD: <b>{speech.vad ? `${speech.vad.lastFrame?.db.toFixed(0) ?? "…"} dB` : speech.vadError ? `off (${speech.vadError})` : "off"}</b>
      </span>
      {speech.monologue && <span className="text-amber-700">monologue restart rule on</span>}
    </div>
  );
}

export function MeterRow({ speech }: { speech: SpeechController }) {
  const f = speech.vad?.lastFrame ?? null;
  return (
    <div>
      <MicMeter frame={f} label="Mic level" />
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>
          level {f ? f.db.toFixed(0) : "–"} dB · <span className="text-sky-700">floor {f ? f.floorDb.toFixed(0) : "–"}</span> ·{" "}
          <span className="text-rose-700">voice threshold {f ? f.thresholdDb.toFixed(0) : "–"}</span>
        </span>
        <span>{f?.voiced ? "voice" : "silence"} · silence {(speech.silenceMs(performance.now()) / 1000).toFixed(1)} s</span>
      </div>
    </div>
  );
}

export function SettingsPanel({ speech }: { speech: SpeechController }) {
  const ptt = speech.recognizer.mode === "push-to-talk";
  const setEc = (on: boolean) => {
    const opts = { ...speech.vadOptions, echoCancellation: on };
    if (speech.vad) void speech.openVad(opts);
    else speech.vadOptions = opts;
  };
  return (
    <Card title="Settings">
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={speech.prefs.headphones} onChange={(e) => speech.setHeadphones(e.target.checked)} />
          Headphones (barge-in on; without them, speech during examiner audio is ignored)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={speech.vadOptions.echoCancellation} onChange={(e) => setEc(e.target.checked)} />
          VAD stream echoCancellation (turn off if the examiner gets quieter when the mic opens)
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => speech.forceRestart()} disabled={!speech.recognizer.isCapturing}>
            Force recognizer restart
          </Button>
          {ptt ? (
            <Button onClick={() => speech.useContinuous()}>Back to continuous recognition</Button>
          ) : (
            <Button onClick={() => speech.usePushToTalk()} disabled={!speech.started}>
              Simulate failure → push-to-talk
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

const RATES = [0.85, 0.9, 1.0];

export function VoicePanel({ speech }: { speech: SpeechController }) {
  const voices = speech.synth.voices
    .filter((v) => rankVoice(v) > 0)
    .sort((a, b) => rankVoice(b) - rankVoice(a) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  const current = speech.synth.voice;
  const ttsStart = speech.metrics.rows().find((r) => r.name === "tts_start");
  const kind = (r: number, local: boolean) => (r === 3 ? "Natural" : r === 2 ? "Google" : local ? "local" : "online");

  return (
    <Card title="Examiner voice" hint="Natural (Edge online) > Google > any English voice. Accent rotates per page load unless pinned.">
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-slate-500">Voice</span>
          <select
            className="mt-1 w-full rounded border border-slate-300 bg-white p-1.5"
            value={speech.prefs.pinnedVoiceURI ?? ""}
            onChange={(e) => speech.pinVoice(e.target.value || null)}
          >
            <option value="">Automatic{current ? ` (${current.name})` : ""}</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                [{kind(rankVoice(v), v.localService)}] {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <label>
            <span className="mr-2 text-slate-500">Accent</span>
            <select
              className="rounded border border-slate-300 bg-white p-1"
              value={speech.prefs.pinnedAccent ?? ""}
              onChange={(e) => speech.pinAccent((e.target.value || null) as Accent | null)}
            >
              <option value="">Rotate</option>
              {ACCENTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <span>
            <span className="mr-2 text-slate-500">Rate</span>
            {RATES.map((r) => (
              <label key={r} className="mr-2">
                <input type="radio" name="rate" checked={speech.synth.rate === r} onChange={() => speech.setRate(r)} /> {r}
              </label>
            ))}
          </span>
        </div>
        <p>
          Examiner: <b>{speech.examiner.name || "–"}</b>, {current ? `${current.name} (${current.lang}, ${current.localService ? "local" : "online"})` : "no English voice"}
        </p>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => void speech.say(`Good morning. My name is ${speech.examiner.name}. Can you tell me your full name, please?`, { then: "discard" })}
            disabled={!current}
          >
            Test voice
          </Button>
          <span className="text-slate-500">voice start delay (last): {ttsStart?.last ?? "–"} ms</span>
        </div>
      </div>
    </Card>
  );
}

function TurnRow({ speech, turn }: { speech: SpeechController; turn: Turn }) {
  const heard = speech.turnText(turn.id);
  if (turn.kind === "examiner") {
    return (
      <li>
        <span className="font-medium text-sky-700">Examiner:</span> {turn.line}
        {heard && <div className="ml-4 text-xs text-slate-400">heard during examiner audio (ignored): “{heard}”</div>}
      </li>
    );
  }
  if (turn.kind === "discard") {
    return heard ? <li className="text-xs text-slate-400">discarded: “{heard}”</li> : null;
  }
  const interim = speech.interims.get(turn.id);
  const final = speech.buffer.text(turn.id);
  return (
    <li>
      <span className="font-medium text-emerald-700">You:</span> {final}{" "}
      {interim && <span className="text-slate-400 italic">{speech.turnText(turn.id).slice(final.length).trim()}</span>}
      {!heard && <span className="text-slate-300">…</span>}
    </li>
  );
}

export function TranscriptPanel({ speech }: { speech: SpeechController }) {
  const turns = speech.turns.slice(-12);
  return (
    <Card title="Live transcript" hint="Grey italic = interim text. Examiner-audio text is shown so you can see echo being kept out.">
      <ul className="max-h-72 space-y-1 overflow-auto text-sm">
        {turns.map((t) => (
          <TurnRow key={t.id} speech={speech} turn={t} />
        ))}
      </ul>
    </Card>
  );
}

export function EventLog({ speech }: { speech: SpeechController }) {
  const events = speech.metrics.getEvents().slice(-40).reverse();
  return (
    <ul className="max-h-64 overflow-auto font-mono text-xs">
      {events.map((e, i) => (
        <li key={`${e.t}-${i}`}>
          <span className="text-slate-400">{(e.t / 1000).toFixed(1)}s</span> <b>{e.type}</b> {e.detail}
        </li>
      ))}
    </ul>
  );
}
