// "Guardar" on the results screen (SPEC 13). A word is kept in localStorage
// at once (so the button answers instantly, even offline) and then sent to
// the Supabase `vocab` table through /api/vocab. Words saved before step 6,
// or while offline, are sent on the next sync (Home calls syncWords()).

import { api } from "../persistence/api";
import type { VocabItem } from "../shared/grade";

const KEY = "vocab.saved.v1";

export interface SavedWord extends VocabItem {
  sessionId: string;
  savedAt: string;
  /** The server has it (missing on words saved in step 5). */
  synced?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type KV = Pick<Storage, "getItem" | "setItem">;

function storage(): KV | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Words are unique by lowercase spelling (as in the vocab table). */
export function wordKey(word: string): string {
  return word.trim().toLowerCase();
}

export function loadSavedWords(kv: KV | null = storage()): SavedWord[] {
  try {
    const raw = kv?.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((w): w is SavedWord => !!w && typeof (w as SavedWord).word === "string") : [];
  } catch {
    return [];
  }
}

/** Saves a word (once) and sends it to the server. Returns false if it couldn't be stored. */
export function saveWord(item: VocabItem, sessionId: string, kv: KV | null = storage(), fetchImpl?: typeof fetch): boolean {
  if (!kv) return false;
  const list = loadSavedWords(kv);
  if (list.some((w) => wordKey(w.word) === wordKey(item.word))) return true;
  try {
    kv.setItem(KEY, JSON.stringify([...list, { ...item, sessionId, savedAt: new Date().toISOString(), synced: false }]));
  } catch {
    return false;
  }
  void syncWords(kv, fetchImpl);
  return true;
}

let syncing: Promise<void> | null = null;
/** A word was saved during a sync: sync again after it. */
let again = false;

/** Sends the words the server doesn't have yet, grouped by session. Never throws. */
export function syncWords(kv: KV | null = storage(), fetchImpl?: typeof fetch): Promise<void> {
  if (syncing) {
    again = true;
    return syncing;
  }
  syncing = (async () => {
    const pending = loadSavedWords(kv).filter((w) => !w.synced);
    const bySession = new Map<string, SavedWord[]>();
    for (const w of pending) bySession.set(w.sessionId, [...(bySession.get(w.sessionId) ?? []), w]);
    for (const [sessionId, words] of bySession) {
      const items = words.map(({ word, es, example, exam, nclex_area }) => ({ word, es, example, exam, nclex_area }));
      const r = await api("/api/vocab", { method: "POST", body: { action: "save", items, sessionId: UUID.test(sessionId) ? sessionId : null }, fetchImpl });
      if (!r.ok) continue;
      const sent = new Set(words.map((w) => wordKey(w.word)));
      try {
        kv?.setItem(KEY, JSON.stringify(loadSavedWords(kv).map((w) => (sent.has(wordKey(w.word)) ? { ...w, synced: true } : w))));
      } catch {
        // Sent again next time; the server ignores duplicates.
      }
    }
  })().finally(() => {
    syncing = null;
    if (again) {
      again = false;
      void syncWords(kv, fetchImpl);
    }
  });
  return syncing;
}

export function isSaved(word: string, kv: KV | null = storage()): boolean {
  return loadSavedWords(kv).some((w) => wordKey(w.word) === wordKey(word));
}
