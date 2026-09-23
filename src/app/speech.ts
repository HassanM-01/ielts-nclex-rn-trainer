// One SpeechController per page load, shared by the lab, the mic check and
// the debug overlay.

import { useEffect, useReducer } from "react";
import { SpeechController } from "../speech/controller";

let instance: SpeechController | null = null;

export function getSpeech(): SpeechController {
  if (!instance) {
    instance = new SpeechController("metrics.v1");
    // Dev only: inspect the speech layer from the console.
    if (import.meta.env.DEV) (window as unknown as { __speech?: SpeechController }).__speech = instance;
  }
  return instance;
}

/** Re-render on controller changes, at most once per animation frame. */
export function useSpeech(): SpeechController {
  const speech = getSpeech();
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    let raf = 0;
    const unsub = speech.subscribe(() => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          force();
        });
    });
    return () => {
      unsub();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [speech]);
  return speech;
}
