// Turn-keyed transcript bookkeeping (SPEC 6: "Final results are appended to
// the current turn buffer by turn id, so no text is ever lost"). Pure.

export interface ResultSnapshot {
  transcript: string;
  confidence: number;
  isFinal: boolean;
}

export interface FinalSegment {
  turnId: number;
  text: string;
  /** 0 means the browser didn't report one. */
  confidence: number;
  at: number;
  session: number;
  /** True when the session ended before this result became final. */
  promoted: boolean;
}

/**
 * Tracks one recognition session's result list. Each result index is tagged
 * with the turn that was current when it first appeared, so speech that
 * started before a turn switch stays with the turn it belongs to.
 */
export class SessionResults {
  private turnOf: number[] = [];
  private lastText: string[] = [];
  private lastConfidence: number[] = [];
  private finalized: boolean[] = [];
  private flushed = false;

  constructor(readonly session: number) {}

  /** Applies the full result list from a `result` event. */
  apply(results: ResultSnapshot[], currentTurn: number, now: number): { finals: FinalSegment[]; interims: Map<number, string> } {
    const finals: FinalSegment[] = [];
    const interims = new Map<number, string>();
    if (this.flushed) return { finals, interims };
    results.forEach((r, i) => {
      if (this.turnOf[i] === undefined) this.turnOf[i] = currentTurn;
      const turnId = this.turnOf[i] ?? currentTurn;
      if (this.finalized[i]) return;
      const text = r.transcript.trim();
      this.lastText[i] = text;
      this.lastConfidence[i] = r.confidence;
      if (r.isFinal) {
        this.finalized[i] = true;
        if (text) finals.push({ turnId, text, confidence: r.confidence, at: now, session: this.session, promoted: false });
      } else if (text) {
        interims.set(turnId, interims.has(turnId) ? `${interims.get(turnId)} ${text}` : text);
      }
    });
    return { finals, interims };
  }

  /** Session ended: promote any result that never became final. */
  flush(now: number): FinalSegment[] {
    if (this.flushed) return [];
    this.flushed = true;
    const out: FinalSegment[] = [];
    this.lastText.forEach((text, i) => {
      if (this.finalized[i] || !text) return;
      this.finalized[i] = true;
      out.push({
        turnId: this.turnOf[i] ?? 0,
        text,
        confidence: this.lastConfidence[i] ?? 0,
        at: now,
        session: this.session,
        promoted: true,
      });
    });
    return out;
  }

  /** Barge-in: results tagged to `from` (not yet final) now belong to `to`. */
  retag(from: number, to: number): void {
    this.turnOf = this.turnOf.map((t, i) => (t === from && !this.finalized[i] ? to : t));
  }
}

/** All final text, by turn. */
export class TranscriptBuffer {
  private turns = new Map<number, FinalSegment[]>();

  add(seg: FinalSegment): void {
    const list = this.turns.get(seg.turnId) ?? [];
    list.push(seg);
    this.turns.set(seg.turnId, list);
  }

  segments(turnId: number): readonly FinalSegment[] {
    return this.turns.get(turnId) ?? [];
  }

  text(turnId: number): string {
    return this.segments(turnId)
      .map((s) => s.text)
      .filter(Boolean)
      .join(" ");
  }

  /** Barge-in: move a turn's segments to another turn. */
  move(from: number, to: number): void {
    const moved = this.turns.get(from);
    if (!moved) return;
    this.turns.delete(from);
    for (const s of moved) this.add({ ...s, turnId: to });
  }

  /** Replace the text of a segment (echo trim on a turn's first result). */
  replaceText(turnId: number, index: number, text: string): void {
    const seg = this.turns.get(turnId)?.[index];
    if (seg) seg.text = text;
  }

  clear(): void {
    this.turns.clear();
  }
}
