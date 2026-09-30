// Home (SPEC 13): the passphrase gate, mode selector, "Empezar examen", the
// mic check, resume after a reload, the last full-test score and distance to
// 7.0, up to 10 saved words due for review, and links to History and Vocab.
// Level and quick practice come in step 7.
//
// Prewarm (SPEC 3.5): load the voice list, ask for mic permission, and fetch
// a token plus this session's questions as soon as Home loads, so the
// "Empezar examen" click can start speaking at once.

import { useEffect, useState } from "react";
import { BrowserBanner } from "../components/BrowserBanner";
import { MicCheck } from "../components/MicCheck";
import { RecognitionBanner } from "../components/RecognitionBanner";
import { t } from "../i18n";
import { canResume, clearCheckpoint, loadCheckpoint } from "../session/checkpoint";
import { resumeExam, startNewExam } from "../session/exam-session";
import type { ScriptMode } from "../exams/ielts";
import { syncWords } from "../grading/vocab-store";
import { fill } from "../i18n";
import { flushPending } from "../persistence/save-client";
import { login, loginStatus, prepareSession, sessionInfo, storedPassphrase, type LoginResult } from "../session/token-client";
import { navigate } from "./router";
import { useSpeech } from "./speech";

const MODES: ScriptMode[] = ["full", "part1", "parts23"];
const MODE_KEY = "exam.mode.v1";

function loadMode(): ScriptMode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    return (MODES as string[]).includes(m ?? "") ? (m as ScriptMode) : "full";
  } catch {
    return "full";
  }
}

function saveMode(m: ScriptMode): void {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    // Remembered for this page only.
  }
}

async function requestMicPermission(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((tr) => tr.stop());
    return true;
  } catch {
    return false;
  }
}

export function Home() {
  const speech = useSpeech();
  const [cp, setCp] = useState(loadCheckpoint);
  const [micBlocked, setMicBlocked] = useState(false);
  const [showMicCheck, setShowMicCheck] = useState(!speech.prefs.micCheckDone);
  const [pass, setPass] = useState("");
  const [passState, setPassState] = useState<LoginResult | "none" | "checking">(storedPassphrase() ? (loginStatus() ?? "ok") : "none");
  const [mode, setMode] = useState<ScriptMode>(loadMode);
  const [info, setInfo] = useState(sessionInfo);

  useEffect(() => {
    void speech.init();
    if (!speech.started) void requestMicPermission().then((ok) => setMicBlocked(!ok));
    // Prewarm a token and this session's questions (SPEC 3.5).
    void prepareSession().then((r) => {
      setPassState(r);
      setInfo(sessionInfo());
    });
    // Saves and saved words that couldn't reach the server earlier.
    void flushPending();
    void syncWords();
  }, [speech]);

  const submitPass = async () => {
    if (!pass.trim()) return;
    setPassState("checking");
    setPassState(await login(pass.trim()));
    setInfo(sessionInfo());
  };

  const start = () => {
    startNewExam(speech, performance.now(), mode);
    navigate("/examen");
  };

  const resume = () => {
    if (!cp) return;
    resumeExam(speech, cp, performance.now());
    navigate("/examen");
  };

  const discard = () => {
    clearCheckpoint();
    setCp(null);
  };

  const resumable = canResume(cp);
  // The passphrase gate: nothing but the passphrase card until a passphrase
  // has worked on this computer. An unreachable server doesn't lock out a
  // passphrase that worked before (practice goes on; SPEC 4 "Resilience").
  const gated = !storedPassphrase() || passState === "wrong";
  const capped = passState === "cap";
  const lastFull = info?.lastFull ?? null;
  const due = (info?.dueWords ?? []).slice(0, 10);

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6" lang="es">
      <h1 className="text-2xl font-semibold">{t.app.title}</h1>
      <BrowserBanner />
      <RecognitionBanner speech={speech} />
      {micBlocked && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">{t.home.micBlocked}</div>}

      {gated && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">{t.home.passTitle}</h2>
          <p className="mb-3 text-slate-700">{t.home.passBody}</p>
          {passState === "wrong" && <p className="mb-2 text-rose-700">{t.home.passWrong}</p>}
          {passState === "unavailable" && <p className="mb-2 text-amber-800">{t.home.passOffline}</p>}
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void submitPass();
            }}
          >
            <input
              type="password"
              autoComplete="current-password"
              className="rounded-lg border border-slate-300 px-3 py-2"
              placeholder={t.home.passPlaceholder}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
            <button type="submit" className="rounded-lg bg-slate-800 px-4 py-2 text-white" disabled={passState === "checking"}>
              {passState === "checking" ? t.home.passChecking : t.home.passSave}
            </button>
          </form>
        </section>
      )}

      {!gated && passState === "unavailable" && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">{t.home.passUnavailable}</div>}
      {!gated && capped && <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-900">{t.home.cap}</div>}

      {!gated && lastFull && (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
          <p className="font-medium text-sky-900">{fill(t.home.lastFull, { band: lastFull.overall.toFixed(1) })}</p>
          <p className="text-sm text-slate-700">
            {lastFull.overall >= 7 ? t.home.atTarget : fill(t.home.toTarget, { n: (7 - lastFull.overall).toFixed(1) })}
          </p>
        </section>
      )}

      {!gated && resumable && (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
          <h2 className="font-semibold">{t.home.resumeTitle}</h2>
          <p className="mb-3 text-slate-700">{t.home.resumeBody}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg bg-slate-800 px-4 py-2 text-white" onClick={resume}>
              {t.home.resume}
            </button>
            <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2" onClick={() => navigate("/resultados")}>
              {t.home.viewSoFar}
            </button>
            <button type="button" className="rounded-lg px-4 py-2 text-slate-600 underline" onClick={discard}>
              {t.home.discard}
            </button>
          </div>
        </section>
      )}

      {!gated && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <fieldset className="mb-4">
            <legend className="mb-2 font-medium">{t.home.modeLabel}</legend>
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => (
                <label
                  key={m}
                  className={`cursor-pointer rounded-lg border px-3 py-2 ${mode === m ? "border-emerald-700 bg-emerald-50 font-medium" : "border-slate-300"}`}
                >
                  <input
                    type="radio"
                    name="mode"
                    className="sr-only"
                    checked={mode === m}
                    onChange={() => {
                      setMode(m);
                      saveMode(m);
                    }}
                  />
                  {t.home.modes[m]}
                </label>
              ))}
            </div>
            <p className="mt-2 text-sm text-slate-600">{t.home.modeHints[mode]}</p>
          </fieldset>
          <button
            type="button"
            className="w-full rounded-xl bg-emerald-700 px-6 py-4 text-xl font-semibold text-white hover:bg-emerald-800 disabled:bg-slate-400"
            disabled={capped}
            onClick={start}
          >
            {t.home.start}
          </button>
          <p className="mt-2 text-sm text-slate-600">{t.home.headphonesTip}</p>
          {cp?.finished && (
            <button type="button" className="mt-3 text-sm text-slate-600 underline" onClick={() => navigate("/resultados")}>
              {t.home.lastExam}
            </button>
          )}
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <button type="button" className="text-slate-700 underline" onClick={() => navigate("/historial")}>
              {t.home.history}
            </button>
            <button type="button" className="text-slate-700 underline" onClick={() => navigate("/vocabulario")}>
              {t.home.vocab}
            </button>
          </div>
        </section>
      )}

      {!gated && due.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">{t.home.dueTitle}</h2>
          <p className="mb-2 text-sm text-slate-600">{t.home.dueHint}</p>
          <ul className="flex flex-wrap gap-2">
            {due.map((w) => (
              <li key={w.word} className="rounded-full bg-slate-100 px-3 py-1 text-sm">
                <span lang="en" className="font-medium">
                  {w.word}
                </span>
                <span className="text-slate-500"> · {w.es}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {gated ? null : showMicCheck ? (
        <div>
          <MicCheck speech={speech} />
          {speech.prefs.micCheckDone && (
            <button type="button" className="mt-2 text-sm text-slate-600 underline" onClick={() => setShowMicCheck(false)}>
              {t.home.hideMicCheck}
            </button>
          )}
        </div>
      ) : (
        <button type="button" className="text-slate-700 underline" onClick={() => setShowMicCheck(true)}>
          {t.home.micCheckAgain}
        </button>
      )}
    </main>
  );
}
