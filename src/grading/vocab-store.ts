// "Guardar" on the results screen (SPEC 13). Step 5 keeps saved words in
// localStorage; step 6 moves them into the Supabase `vocab` table.

import type { VocabItem } from "../shared/grade";

const KEY = "vocab.saved.v1";

export interface SavedWord extends VocabItem {
  sessionId: string;
  savedAt: string;
}

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

/** Saves a word (once). Returns false if it couldn't be stored. */
export function saveWord(item: VocabItem, sessionId: string, kv: KV | null = storage()): boolean {
  if (!kv) return false;
  const list = loadSavedWords(kv);
  if (list.some((w) => wordKey(w.word) === wordKey(item.word))) return true;
  try {
    kv.setItem(KEY, JSON.stringify([...list, { ...item, sessionId, savedAt: new Date().toISOString() }]));
    return true;
  } catch {
    return false;
  }
}

export function isSaved(word: string, kv: KV | null = storage()): boolean {
  return loadSavedWords(kv).some((w) => wordKey(w.word) === wordKey(word));
}
