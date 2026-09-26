// The results route is lazy (SPEC 13: keep the exam route small), but its
// chunk is fetched while the exam runs, so the local stats can appear
// within 200 ms of the end (SPEC 3).

let pending: Promise<typeof import("./ResultsScreen")> | null = null;

export function loadResultsScreen(): Promise<typeof import("./ResultsScreen")> {
  pending ??= import("./ResultsScreen");
  return pending;
}
