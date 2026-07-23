import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCheckRateLimit, mockRedis, mockGetIp, mockHashIp, mockSaddDaily, mockUtcDateString } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockRedis: {
    sadd: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    incrby: vi.fn().mockResolvedValue(1),
    hincrby: vi.fn().mockResolvedValue(1),
  },
  mockGetIp: vi.fn().mockReturnValue("1.2.3.4"),
  mockHashIp: vi.fn().mockResolvedValue("hashed-id"),
  mockSaddDaily: vi.fn().mockResolvedValue(undefined),
  mockUtcDateString: vi.fn().mockReturnValue("2026-07-23"),
}));

vi.mock("../api/_lib/rate-limit", () => ({
  redis: mockRedis,
  getIp: mockGetIp,
  hashIp: mockHashIp,
  createLimiter: vi.fn().mockReturnValue({ limit: vi.fn() }),
  checkRateLimit: mockCheckRateLimit,
  rateLimitedResponse: () => new Response("", { status: 429 }),
}));

vi.mock("../api/_lib/daily", () => ({
  saddDaily: mockSaddDaily,
  utcDateString: mockUtcDateString,
}));

import trackHandler from "../api/track";

function postJson(body: unknown): Request {
  return new Request("https://x.test/api/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockUtcDateString.mockReturnValue("2026-07-23");
});

describe("api/track daily buckets", () => {
  it("always buckets the overall visitors set for today, alongside the cumulative one", async () => {
    await trackHandler(postJson({ event: "visit" }));
    expect(mockRedis.sadd).toHaveBeenCalledWith("visitors:all", "hashed-id");
    expect(mockSaddDaily).toHaveBeenCalledWith("visitors:2026-07-23", "hashed-id");
  });

  it("buckets visitors:generated:<date> alongside the cumulative set", async () => {
    await trackHandler(postJson({ event: "generated" }));
    expect(mockRedis.sadd).toHaveBeenCalledWith("visitors:generated", "hashed-id");
    expect(mockSaddDaily).toHaveBeenCalledWith("visitors:generated:2026-07-23", "hashed-id");
  });

  it("buckets visitors:copied:<date>", async () => {
    await trackHandler(postJson({ event: "copied", method: "button" }));
    expect(mockSaddDaily).toHaveBeenCalledWith("visitors:copied:2026-07-23", "hashed-id");
  });

  it("buckets visitors:suite_downloaded:<date>, alongside the existing cumulative counters", async () => {
    await trackHandler(postJson({ event: "suite_downloaded", endpointCount: 5, specVersion: "3.0.0" }));
    expect(mockSaddDaily).toHaveBeenCalledWith("visitors:suite_downloaded:2026-07-23", "hashed-id");
    expect(mockRedis.incrby).toHaveBeenCalledWith("activity:suite_downloaded:endpoints_total", 5);
  });

  it("buckets visitors:thumbs_up:<date>", async () => {
    await trackHandler(postJson({ event: "thumbs_up" }));
    expect(mockSaddDaily).toHaveBeenCalledWith("visitors:thumbs_up:2026-07-23", "hashed-id");
  });

  it("buckets visitors:thumbs_down:<date>", async () => {
    await trackHandler(postJson({ event: "thumbs_down" }));
    expect(mockSaddDaily).toHaveBeenCalledWith("visitors:thumbs_down:2026-07-23", "hashed-id");
  });

  it("buckets visitors:tried_sample:<date>", async () => {
    await trackHandler(postJson({ event: "tried_sample" }));
    expect(mockSaddDaily).toHaveBeenCalledWith("visitors:tried_sample:2026-07-23", "hashed-id");
  });

  it("buckets visitors:returned:<date> only once the visitor crosses the 2-visit threshold", async () => {
    mockRedis.incr.mockResolvedValueOnce(1); // first visit ever
    await trackHandler(postJson({ event: "visit" }));
    expect(mockSaddDaily).not.toHaveBeenCalledWith("visitors:returned:2026-07-23", "hashed-id");

    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockRedis.incr.mockResolvedValueOnce(2); // second visit
    await trackHandler(postJson({ event: "visit" }));
    expect(mockSaddDaily).toHaveBeenCalledWith("visitors:returned:2026-07-23", "hashed-id");
  });

  it("doesn't add an event-specific daily bucket for events outside the daily view's scope", async () => {
    // Only the top-level visitors:<date> bucket (common to every event) should fire —
    // fetched_url and tried_example aren't part of the daily-stats metric set.
    await trackHandler(postJson({ event: "fetched_url" }));
    expect(mockSaddDaily).toHaveBeenCalledTimes(1);
    expect(mockSaddDaily).toHaveBeenCalledWith("visitors:2026-07-23", "hashed-id");

    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    await trackHandler(postJson({ event: "tried_example", method: "petstore" }));
    expect(mockSaddDaily).toHaveBeenCalledTimes(1);
    expect(mockSaddDaily).toHaveBeenCalledWith("visitors:2026-07-23", "hashed-id");
  });

  it("skips all daily bucketing when the rate limiter denies the request", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, reset: Date.now() + 1000 });
    const res = await trackHandler(postJson({ event: "generated" }));
    expect(res.status).toBe(429);
    expect(mockSaddDaily).not.toHaveBeenCalled();
  });
});
