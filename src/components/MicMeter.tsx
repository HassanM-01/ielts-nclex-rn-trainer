import type { VadFrame } from "../speech/vad-detector";

const MIN_DB = -90;

function pct(db: number): number {
  return Math.max(0, Math.min(100, ((db - MIN_DB) / -MIN_DB) * 100));
}

/** Live mic level with the VAD noise floor and voice threshold marked. */
export function MicMeter({ frame, label, showMarkers = true }: { frame: VadFrame | null; label: string; showMarkers?: boolean }) {
  const db = frame?.db ?? MIN_DB;
  return (
    <div aria-label={label}>
      <div className="relative h-3 w-full overflow-hidden rounded bg-slate-200">
        <div
          className={`h-full ${frame?.voiced ? "bg-emerald-500" : "bg-slate-400"}`}
          style={{ width: `${pct(db)}%` }}
        />
        {showMarkers && frame && (
          <>
            <div className="absolute top-0 h-full w-0.5 bg-sky-600" style={{ left: `${pct(frame.floorDb)}%` }} />
            <div className="absolute top-0 h-full w-0.5 bg-rose-600" style={{ left: `${pct(frame.thresholdDb)}%` }} />
          </>
        )}
      </div>
    </div>
  );
}
