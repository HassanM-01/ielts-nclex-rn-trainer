import { describe, expect, it } from "vitest";
import { budgetStatus, percentile, summarize } from "./stats";

describe("percentile", () => {
  it("uses nearest rank", () => {
    const xs = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000];
    expect(percentile(xs, 50)).toBe(500);
    expect(percentile(xs, 95)).toBe(1_000);
    expect(percentile([42], 95)).toBe(42);
  });
  it("does not depend on input order", () => {
    expect(percentile([900, 100, 500], 50)).toBe(500);
  });
  it("returns null with no data", () => {
    expect(percentile([], 50)).toBeNull();
  });
});

describe("budgetStatus", () => {
  it("checks p50 against the target and p95 against the limit", () => {
    expect(budgetStatus(summarize([300, 350, 400]), 400, 800)).toBe("ok");
    expect(budgetStatus(summarize([450, 500, 600]), 400, 800)).toBe("over-target");
    expect(budgetStatus(summarize([300, 350, 900]), 400, 800)).toBe("over-limit");
    expect(budgetStatus(summarize([]), 400, 800)).toBe("none");
  });
});
