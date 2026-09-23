// Hidden debug overlay (SPEC 3): Shift+D toggles it on any page.

import { useEffect, useState } from "react";
import { useSpeech } from "../app/speech";
import { MetricsPanel } from "./MetricsPanel";

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

export function DebugOverlay() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "D" || e.key === "d") && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!open) return null;
  return <Overlay onClose={() => setOpen(false)} />;
}

function Overlay({ onClose }: { onClose: () => void }) {
  const speech = useSpeech();
  return (
    <div className="fixed right-2 bottom-2 z-50 max-h-[80vh] w-[min(560px,calc(100vw-16px))] overflow-auto rounded-lg border border-slate-300 bg-white/95 p-3 shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Debug (Shift+D)</span>
        <button type="button" className="text-sm text-slate-500" onClick={onClose}>
          close
        </button>
      </div>
      <MetricsPanel metrics={speech.metrics} compact />
    </div>
  );
}
