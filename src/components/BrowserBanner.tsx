import { t } from "../i18n";
import { currentBrowser } from "../speech/browser";
import { Recognizer } from "../speech/recognizer";

/** First-run banner if the browser isn't Edge or Chrome (SPEC 13). */
export function BrowserBanner() {
  if (currentBrowser() !== "other" && Recognizer.isSupported()) return null;
  return <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">{t.browser.unsupported}</div>;
}
