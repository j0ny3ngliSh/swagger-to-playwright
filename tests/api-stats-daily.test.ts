import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCheckRateLimit, mockRedis, mockGetIp, mockHashIp, mockLastNDates, mockCreateLimiter } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockRedis: { pipeline: vi.fn() },
  mockGetIp: vi.fn().mockReturnValue("1.2.3.4"),
  mockHashIp: vi.fn().mockResolvedValue("hashed-id"),
  mockLastNDates: vi.fn(),
  mockCreateLimiter: vi.fn().mockReturnValue({ limit: vi.fn() }),
}));

vi.mock("../api/_lib/rate-limit", () => ({
  redis: mockRedis,
  getIp: mockGetIp,
  hashIp: mockHashIp,
  createLimiter: mockCreateLimiter,
  checkRateLimit: mockCheckRateLimit,
  rateLimitedResponse: (reset?: number) => {
    const retryAfterSeconds = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 1000)) : 60;
    return new Response("Too many requests — please slow down.", {
      status: 429,
      headers: { "content-type": "text/plain", "retry-after": String(retryAfterSeconds) },
    });
  },
}));

vi.mock("../api/_lib/daily", () => ({
  lastNDates: mockLastNDates,
}));

import statsDailyHandler from "../api/stats-daily";

// createLimiter runs once at module load (top-level `const ... = createLimiter(...)`),
// before any test's beforeEach clears the mock — snapshot the call now.
const createLimiterCallsAtLoad = mockCreateLimiter.mock.calls.slice();

function makePipeline(execResult: number[]) {
  const pipeline: any = {
    scard: vi.fn(() => pipeline),
    exec: vi.fn().mockResolvedValue(execResult),
  };
  return pipeline;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("api/stats-daily rate limiting", () => {
  it("returns 429 without ever touching redis when the limiter denies", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, reset: Date.now() + 20_000 });
    const res = await statsDailyHandler(new Request("https://x.test/api/stats-daily"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(mockRedis.pipeline).not.toHaveBeenCalled();
  });

  it("configures its own limiter (20 req/min, 'stats-daily' prefix) at module load", () => {
    expect(createLimiterCallsAtLoad).toContainEqual(["stats-daily", 20, "1 m"]);
  });
});

describe("api/stats-daily `days` param", () => {
  beforeEach(() => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockLastNDates.mockReturnValue(["2026-07-23"]);
    mockRedis.pipeline.mockReturnValue(makePipeline(new Array(8).fill(0)));
  });

  it("defaults to 30 days when no param is given", async () => {
    await statsDailyHandler(new Request("https://x.test/api/stats-daily"));
    expect(mockLastNDates).toHaveBeenCalledWith(30);
  });

  it("clamps an oversized value to 90 (matches the daily-key TTL)", async () => {
    await statsDailyHandler(new Request("https://x.test/api/stats-daily?days=99999"));
    expect(mockLastNDates).toHaveBeenCalledWith(90);
  });

  it("falls back to the default for a non-numeric value", async () => {
    await statsDailyHandler(new Request("https://x.test/api/stats-daily?days=nonsense"));
    expect(mockLastNDates).toHaveBeenCalledWith(30);
  });

  it("falls back to the default for a zero/negative value", async () => {
    await statsDailyHandler(new Request("https://x.test/api/stats-daily?days=0"));
    expect(mockLastNDates).toHaveBeenCalledWith(30);
  });

  it("honors a valid explicit value", async () => {
    await statsDailyHandler(new Request("https://x.test/api/stats-daily?days=7"));
    expect(mockLastNDates).toHaveBeenCalledWith(7);
  });
});

describe("api/stats-daily response shape", () => {
  it("returns { days, metrics, daily } with one row per date and every metric mapped from the pipeline results", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockLastNDates.mockReturnValue(["2026-07-22", "2026-07-23"]);
    // 8 metrics × 2 dates = 16 scard results, in date-major order.
    const counts = [1, 2, 3, 4, 5, 6, 7, 8, 10, 20, 30, 40, 50, 60, 70, 80];
    mockRedis.pipeline.mockReturnValue(makePipeline(counts));

    const res = await statsDailyHandler(new Request("https://x.test/api/stats-daily?days=2"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.days).toBe(2);
    expect(body.metrics).toEqual([
      "visitors",
      "generated",
      "copied",
      "suite_downloaded",
      "thumbs_up",
      "thumbs_down",
      "tried_sample",
      "returned",
    ]);
    expect(body.daily).toHaveLength(2);
    expect(body.daily[0]).toMatchObject({ date: "2026-07-22", visitors: 1, generated: 2, returned: 8 });
    expect(body.daily[1]).toMatchObject({ date: "2026-07-23", visitors: 10, generated: 20, returned: 80 });
  });

  it("never queries subscribers:emails or feedback:missing", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    mockLastNDates.mockReturnValue(["2026-07-23"]);
    const pipeline = makePipeline(new Array(8).fill(0));
    mockRedis.pipeline.mockReturnValue(pipeline);

    await statsDailyHandler(new Request("https://x.test/api/stats-daily"));

    const scardKeys = pipeline.scard.mock.calls.map((c: any[]) => c[0]);
    expect(scardKeys.length).toBeGreaterThan(0);
    expect(scardKeys.every((k: string) => !k.includes("subscribers") && !k.includes("feedback"))).toBe(true);
  });
});
