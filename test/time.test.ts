import { describe, it, expect } from "vitest";
import { getTimeRange } from "../src/lib/time";

describe("getTimeRange", () => {
  it("returns a range for 7d", () => {
    const range = getTimeRange("7d");
    expect(range.end - range.start).toBeCloseTo(7 * 86400, -1);
  });

  it("returns a range for 30d", () => {
    const range = getTimeRange("30d");
    expect(range.end - range.start).toBeCloseTo(30 * 86400, -1);
  });

  it("returns today range starting at midnight", () => {
    const range = getTimeRange("today");
    expect(range.end).toBeGreaterThan(range.start);
    expect(range.end - range.start).toBeLessThanOrEqual(86400);
  });

  it("handles custom range", () => {
    const range = getTimeRange("custom", "2025-01-01", "2025-01-31");
    expect(range.start).toBeGreaterThan(0);
    expect(range.end).toBeGreaterThan(range.start);
  });

  it("defaults to 30d for unknown period", () => {
    const range = getTimeRange("unknown");
    expect(range.end - range.start).toBeCloseTo(30 * 86400, -1);
  });
});
