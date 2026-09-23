// One SpeechController per page load, shared by the lab, the mic check, the
// exam screen and the debug overlay.

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

/**
 * Re-render on changes, at most once per animation frame (SPEC 13: render
 * the interim transcript at most once per frame).
 */
export function useFrameSubscription(subscribe: ((fn: () => void) => () => void) | null): void {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!subscribe) return;
    let raf = 0;
    const unsub = subscribe(() => {
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
  }, [subscribe]);
}

export function useSpeech(): SpeechController {
  const speech = getSpeech();
  useFrameSubscription(speech.subscribeBound);
  return speech;
}
