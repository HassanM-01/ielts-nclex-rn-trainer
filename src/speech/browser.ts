// Browser detection for engine logging and the "use Edge or Chrome" banner.

export type BrowserName = "edge" | "chrome" | "other";

export function detectBrowser(userAgent: string, isBrave = false): BrowserName {
  if (/\bEdg\//.test(userAgent)) return "edge";
  if (isBrave) return "other"; // Brave ships webkitSpeechRecognition but it doesn't work
  if (/\b(OPR|Opera|SamsungBrowser|YaBrowser|Vivaldi)\//.test(userAgent)) return "other";
  if (/\bChrome\//.test(userAgent)) return "chrome";
  return "other";
}

export function browserVersion(userAgent: string, browser: BrowserName): string {
  const re = browser === "edge" ? /\bEdg\/([\d.]+)/ : /\bChrome\/([\d.]+)/;
  return re.exec(userAgent)?.[1] ?? "";
}

export function currentBrowser(): BrowserName {
  const nav = navigator as Navigator & { brave?: unknown };
  return detectBrowser(navigator.userAgent, nav.brave !== undefined);
}
