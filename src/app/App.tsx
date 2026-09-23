import { lazy, Suspense } from "react";
import { DebugOverlay } from "../components/DebugOverlay";
import { ExamScreen } from "../exam/ExamScreen";
import { TranscriptScreen } from "../exam/TranscriptScreen";
import { Home } from "./Home";
import { usePath } from "./router";

const LabPage = lazy(() => import("../lab/LabPage"));

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
    case "/transcripcion":
      return <TranscriptScreen />;
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
