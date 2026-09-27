// The results route is lazy (SPEC 13: keep the exam route small), but its
// chunk is fetched while the exam runs, so the local stats can appear
// within 200 ms of the end (SPEC 3). Once loaded, the app renders the
// component directly: going through React.lazy and Suspense again would let
// React hold the fallback for its ~300 ms reveal throttle.

import type { ComponentType } from "react";

type Module = typeof import("./ResultsScreen");

let pending: Promise<Module> | null = null;
let loaded: ComponentType | null = null;

export function loadResultsScreen(): Promise<Module> {
  pending ??= import("./ResultsScreen").then((m) => {
    loaded = m.default;
    return m;
  });
  return pending;
}

/** The results screen, if its chunk has already arrived. */
export function loadedResultsScreen(): ComponentType | null {
  return loaded;
}
