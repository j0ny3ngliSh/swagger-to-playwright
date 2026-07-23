import { describe, it, expect } from "vitest";
import { computeBarHeights, shortDateLabel } from "../src/daily-stats";

describe("computeBarHeights", () => {
  it("scales values proportionally to the max", () => {
    expect(computeBarHeights([0, 5, 10], 40)).toEqual([0, 20, 40]);
  });

  it("returns all-zero heights for an all-zero series instead of dividing by zero", () => {
    expect(computeBarHeights([0, 0, 0], 40)).toEqual([0, 0, 0]);
  });

  it("returns all-zero heights for an empty series", () => {
    expect(computeBarHeights([], 40)).toEqual([]);
  });

  it("scales a single non-zero value to the max height", () => {
    expect(computeBarHeights([7], 40)).toEqual([40]);
  });

  it("rounds to the nearest pixel", () => {
    expect(computeBarHeights([1, 3], 10)).toEqual([3, 10]);
  });
});

describe("shortDateLabel", () => {
  it("strips the year from an ISO date", () => {
    expect(shortDateLabel("2026-07-23")).toBe("07-23");
  });
});
