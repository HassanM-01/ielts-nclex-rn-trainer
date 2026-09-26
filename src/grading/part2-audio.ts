// Part 2 replay (SPEC 13): the long turn is recorded from the mic-level
// stream with MediaRecorder, kept in memory for this page only, and never
// uploaded. If recording isn't possible the results screen just has no
// replay; nothing else depends on it.

let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let current: { sessionId: string; url: string } | null = null;

export function startPart2Recording(sessionId: string, stream: MediaStream | null | undefined): void {
  stopPart2Recording();
  if (!stream || typeof MediaRecorder === "undefined") return;
  try {
    const rec = new MediaRecorder(stream);
    chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      if (chunks.length === 0) return;
      if (current) URL.revokeObjectURL(current.url);
      current = { sessionId, url: URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || "audio/webm" })) };
      chunks = [];
    };
    rec.start(1_000);
    recorder = rec;
  } catch {
    recorder = null;
  }
}

export function stopPart2Recording(): void {
  const rec = recorder;
  recorder = null;
  if (rec && rec.state !== "inactive") {
    try {
      rec.stop();
    } catch {
      // Already stopped (the stream ended).
    }
  }
}

/** Object URL of this session's Part 2 recording, if one exists on this page. */
export function part2AudioUrl(sessionId: string): string | null {
  return current?.sessionId === sessionId ? current.url : null;
}
