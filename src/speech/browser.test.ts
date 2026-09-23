import { describe, expect, it } from "vitest";
import { browserVersion, detectBrowser } from "./browser";

const EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.54";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0";
const OPERA = `${CHROME} OPR/121.0.0.0`;

describe("detectBrowser", () => {
  it("tells Edge from Chrome", () => {
    expect(detectBrowser(EDGE)).toBe("edge");
    expect(detectBrowser(CHROME)).toBe("chrome");
  });
  it("treats Firefox, Opera and Brave as unsupported", () => {
    expect(detectBrowser(FIREFOX)).toBe("other");
    expect(detectBrowser(OPERA)).toBe("other");
    expect(detectBrowser(CHROME, true)).toBe("other");
  });
  it("reads the version", () => {
    expect(browserVersion(EDGE, "edge")).toBe("140.0.3485.54");
    expect(browserVersion(CHROME, "chrome")).toBe("140.0.0.0");
  });
});
