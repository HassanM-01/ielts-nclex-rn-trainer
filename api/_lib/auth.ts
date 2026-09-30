// The passphrase header for the History, Vocab and session-save routes
// (SPEC 4: "History and vocab routes take the passphrase header").

import { safeEqual } from "./token.js";

export const PASSPHRASE_HEADER = "x-app-passphrase";

export function passphraseOk(request: Request): boolean {
  const expected = process.env.APP_PASSPHRASE;
  const given = request.headers.get(PASSPHRASE_HEADER);
  return !!expected && given !== null && safeEqual(given.trim(), expected);
}

/** DAILY_SESSION_CAP, default 12 (SPEC 4). */
export function dailyCap(): number {
  const n = Number(process.env.DAILY_SESSION_CAP);
  return Number.isInteger(n) && n > 0 ? n : 12;
}
