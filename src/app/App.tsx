import { lazy, Suspense } from "react";
import { DebugOverlay } from "../components/DebugOverlay";
import { Home } from "./Home";
import { usePath } from "./router";

const LabPage = lazy(() => import("../lab/LabPage"));

export function App() {
  const path = usePath();
  return (
    <>
      {path === "/lab" ? (
        <Suspense fallback={null}>
          <LabPage />
        </Suspense>
      ) : (
        <Home />
      )}
      <DebugOverlay />
    </>
  );
}
