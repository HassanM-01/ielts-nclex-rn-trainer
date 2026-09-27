import { lazy, Suspense } from "react";
import { DebugOverlay } from "../components/DebugOverlay";
import { ExamScreen } from "../exam/ExamScreen";
import { loadedResultsScreen, loadResultsScreen } from "../results/load";
import { Home } from "./Home";
import { usePath } from "./router";

const LabPage = lazy(() => import("../lab/LabPage"));
const ResultsScreen = lazy(loadResultsScreen);

function Route({ path }: { path: string }) {
  switch (path) {
    case "/lab":
      return (
        <Suspense fallback={null}>
          <LabPage />
        </Suspense>
      );
    case "/examen":
      return <ExamScreen />;
    case "/resultados":
    // The step 2 transcript page's old address.
    case "/transcripcion": {
      const Loaded = loadedResultsScreen();
      return Loaded ? (
        <Loaded />
      ) : (
        <Suspense fallback={null}>
          <ResultsScreen />
        </Suspense>
      );
    }
    default:
      return <Home />;
  }
}

export function App() {
  const path = usePath();
  return (
    <>
      <Route path={path} />
      <DebugOverlay />
    </>
  );
}
