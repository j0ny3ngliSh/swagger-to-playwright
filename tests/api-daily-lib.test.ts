import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockRedis } = vi.hoisted(() => ({
  mockRedis: {
    sadd: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock("../api/_lib/rate-limit", () => ({
  redis: mockRedis,
}));

import { utcDateString, saddDaily, lastNDates, DAILY_TTL_SECONDS } from "../api/_lib/daily";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("utcDateString", () => {
  it("formats a Date as YYYY-MM-DD in UTC", () => {
    expect(utcDateString(new Date("2026-07-23T23:59:00Z"))).toBe("2026-07-23");
  });

  it("uses UTC even for a time that would roll over in a positive-offset local zone", () => {
    // 2026-07-23T00:30:00Z is still 2026-07-23 in UTC regardless of host machine timezone.
    expect(utcDateString(new Date("2026-07-23T00:30:00Z"))).toBe("2026-07-23");
  });
});

describe("saddDaily", () => {
  it("adds the member to the set and refreshes its TTL", async () => {
    await saddDaily("visitors:2026-07-23", "hashed-id");
    expect(mockRedis.sadd).toHaveBeenCalledWith("visitors:2026-07-23", "hashed-id");
    expect(mockRedis.expire).toHaveBeenCalledWith("visitors:2026-07-23", DAILY_TTL_SECONDS);
  });
});

describe("lastNDates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the requested number of dates", () => {
    expect(lastNDates(7)).toHaveLength(7);
  });

  it("is oldest-first and ends on today", () => {
    const dates = lastNDates(3);
    expect(dates).toEqual(["2026-07-21", "2026-07-22", "2026-07-23"]);
  });

  it("returns a single date (today) when asked for 1 day", () => {
    expect(lastNDates(1)).toEqual(["2026-07-23"]);
  });

  it("correctly crosses a month boundary", () => {
    vi.setSystemTime(new Date("2026-08-01T12:00:00Z"));
    expect(lastNDates(3)).toEqual(["2026-07-30", "2026-07-31", "2026-08-01"]);
  });
});
