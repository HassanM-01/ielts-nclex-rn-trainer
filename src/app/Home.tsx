// Home (SPEC 13, step 2 version): "Empezar examen", the mic check, resume
// after a reload. Mode selector, level and last score come in steps 4 to 7.
//
// Prewarm (SPEC 3.5): load the voice list and ask for mic permission as soon
// as Home loads, so the "Empezar examen" click can start speaking at once.

import { useEffect, useState } from "react";
import { BrowserBanner } from "../components/BrowserBanner";
import { MicCheck } from "../components/MicCheck";
import { RecognitionBanner } from "../components/RecognitionBanner";
import { t } from "../i18n";
import { canResume, clearCheckpoint, loadCheckpoint } from "../session/checkpoint";
import { resumeExam, startNewExam } from "../session/exam-session";
import { getToken, login, loginStatus, storedPassphrase, type LoginResult } from "../session/token-client";
import { navigate } from "./router";
import { useSpeech } from "./speech";

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

  useEffect(() => {
    void speech.init();
    if (!speech.started) void requestMicPermission().then((ok) => setMicBlocked(!ok));
    // Prewarm the session token (SPEC 3.5).
    if (storedPassphrase()) void getToken().then(() => setPassState(loginStatus() ?? "ok"));
  }, [speech]);

  const submitPass = async () => {
    if (!pass.trim()) return;
    setPassState("checking");
    setPassState(await login(pass.trim()));
  };

  const start = () => {
    startNewExam(speech, performance.now());
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

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-6" lang="es">
      <h1 className="text-2xl font-semibold">{t.app.title}</h1>
      <BrowserBanner />
      <RecognitionBanner speech={speech} />
      {micBlocked && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">{t.home.micBlocked}</div>}

      {passState !== "ok" && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">{t.home.passTitle}</h2>
          {passState !== "unavailable" && <p className="mb-3 text-slate-700">{t.home.passBody}</p>}
          {passState === "wrong" && <p className="mb-2 text-rose-700">{t.home.passWrong}</p>}
          {passState === "unavailable" && <p className="mb-2 text-amber-800">{t.home.passUnavailable}</p>}
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

      {resumable && (
        <section className="rounded-lg border border-sky-200 bg-sky-50 p-4">
          <h2 className="font-semibold">{t.home.resumeTitle}</h2>
          <p className="mb-3 text-slate-700">{t.home.resumeBody}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg bg-slate-800 px-4 py-2 text-white" onClick={resume}>
              {t.home.resume}
            </button>
            <button type="button" className="rounded-lg border border-slate-300 bg-white px-4 py-2" onClick={() => navigate("/transcripcion")}>
              {t.home.viewSoFar}
            </button>
            <button type="button" className="rounded-lg px-4 py-2 text-slate-600 underline" onClick={discard}>
              {t.home.discard}
            </button>
          </div>
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <button type="button" className="w-full rounded-xl bg-emerald-700 px-6 py-4 text-xl font-semibold text-white hover:bg-emerald-800" onClick={start}>
          {t.home.start}
        </button>
        <p className="mt-2 text-sm text-slate-600">{t.home.startHint}</p>
        {cp?.finished && (
          <button type="button" className="mt-3 text-sm text-slate-600 underline" onClick={() => navigate("/transcripcion")}>
            {t.home.lastExam}
          </button>
        )}
      </section>

      {showMicCheck ? (
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
