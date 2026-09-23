// Placeholder until step 2 builds the real Home screen.

import { BrowserBanner } from "../components/BrowserBanner";
import { t } from "../i18n";

export function Home() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-4 text-2xl font-semibold">{t.app.title}</h1>
      <BrowserBanner />
      <p className="text-slate-600">{t.app.underConstruction}</p>
    </main>
  );
}
