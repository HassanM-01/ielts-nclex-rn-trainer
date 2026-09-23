// Tiny path router: the app has a handful of routes, so no router library.

import { useSyncExternalStore } from "react";

function subscribe(fn: () => void): () => void {
  window.addEventListener("popstate", fn);
  return () => window.removeEventListener("popstate", fn);
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname.replace(/\/+$/, "") || "/");
}

export function navigate(to: string): void {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
