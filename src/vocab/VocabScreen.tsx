// Vocab (SPEC 12): saved words with their exam tags and a mastered toggle.
// A lazy route. (The "Términos NCLEX" tab arrives with Clinical mode, step 8.)

import { useEffect, useState } from "react";
import { navigate } from "../app/router";
import { loadSavedWords, syncWords } from "../grading/vocab-store";
import { fill, t } from "../i18n";
import { api } from "../persistence/api";
import type { VocabRow } from "../shared/persistence-api";

type Load = { state: "loading" } | { state: "error" } | { state: "ok"; rows: VocabRow[] };

export default function VocabScreen() {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [n, setN] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setLoad({ state: "loading" });
    // Send words saved offline (or in step 5) first, so the list is complete.
    void syncWords()
      .then(() => api<VocabRow[]>("/api/vocab"))
      .then((r) => {
        if (live) setLoad(r.ok ? { state: "ok", rows: r.data } : { state: "error" });
      });
    return () => {
      live = false;
    };
  }, [n]);

  const toggle = async (row: VocabRow) => {
    setFailed(null);
    const mastered = !row.mastered;
    setLoad((l) => (l.state === "ok" ? { state: "ok", rows: l.rows.map((r) => (r.word === row.word ? { ...r, mastered } : r)) } : l));
    const r = await api("/api/vocab", { method: "POST", body: { action: "mastered", word: row.word, mastered } });
    if (!r.ok) {
      setFailed(row.word);
      setLoad((l) => (l.state === "ok" ? { state: "ok", rows: l.rows.map((x) => (x.word === row.word ? { ...x, mastered: row.mastered } : x)) } : l));
    }
  };

  const unsynced = loadSavedWords().some((w) => !w.synced);

  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6" lang="es">
      <div>
        <h1 className="text-2xl font-semibold">{t.vocab.title}</h1>
        <p className="text-slate-600">{t.vocab.hint}</p>
      </div>
      {load.state === "loading" && <p className="text-slate-500">{t.vocab.loading}</p>}
      {load.state === "error" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <p className="mb-2">{t.vocab.error}</p>
          <button type="button" className="rounded-lg bg-slate-800 px-4 py-2 text-white" onClick={() => setN((x) => x + 1)}>
            {t.vocab.retry}
          </button>
        </div>
      )}
      {load.state === "ok" && unsynced && <p className="text-sm text-amber-800">{t.vocab.pendingSync}</p>}
      {load.state === "ok" && load.rows.length === 0 && <p className="text-slate-600">{t.vocab.empty}</p>}
      {load.state === "ok" && load.rows.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {load.rows.map((r) => (
            <li key={r.word} className={`flex flex-wrap items-start justify-between gap-3 p-3 ${r.mastered ? "opacity-60" : ""}`}>
              <div>
                <span className="font-semibold" lang="en">
                  {r.word}
                </span>
                <span className="text-slate-600"> · {r.es}</span>
                {r.examTags.map((tag) => (
                  <span key={tag} className="ml-2 rounded bg-slate-100 px-1.5 text-xs text-slate-600">
                    {t.vocab.tags[tag] ?? tag}
                  </span>
                ))}
                {r.example && (
                  <p className="text-sm text-slate-600 italic" lang="en">
                    {r.example}
                  </p>
                )}
                <p className="text-xs text-slate-500">{fill(t.vocab.usedCorrectly, { n: String(Math.min(3, r.timesUsedCorrectly)) })}</p>
                {failed === r.word && <p className="text-sm text-rose-700">{t.vocab.toggleFailed}</p>}
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={r.mastered} onChange={() => void toggle(r)} />
                {t.vocab.mastered}
              </label>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="rounded-lg bg-slate-800 px-4 py-2 text-white" onClick={() => navigate("/")}>
        {t.vocab.backHome}
      </button>
    </main>
  );
}
