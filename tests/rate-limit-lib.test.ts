import { describe, it, expect, vi } from "vitest";

// api/_lib/rate-limit.ts constructs a real Redis client at module scope — mock the
// package so importing it in tests doesn't need real KV_REST_API_URL/TOKEN env vars.
vi.mock("@upstash/redis", () => ({
  Redis: class {},
}));

import { getIp, hashIp, checkRateLimit, rateLimitedResponse } from "../api/_lib/rate-limit";

describe("getIp", () => {
  it("prefers the first entry of x-forwarded-for", () => {
    const req = new Request("https://example.com", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new Request("https://example.com", { headers: { "x-real-ip": "9.9.9.9" } });
    expect(getIp(req)).toBe("9.9.9.9");
  });

  it("falls back to 'unknown' when neither header is present", () => {
    const req = new Request("https://example.com");
    expect(getIp(req)).toBe("unknown");
  });
});

describe("hashIp", () => {
  it("produces a stable SHA-256 hex digest", async () => {
    const hash = await hashIp("1.2.3.4");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashIp("1.2.3.4")).toBe(hash);
  });

  it("produces different hashes for different IPs", async () => {
    expect(await hashIp("1.2.3.4")).not.toBe(await hashIp("5.6.7.8"));
  });
});

describe("checkRateLimit", () => {
  it("allows the request when the limiter reports success", async () => {
    const limiter = { limit: vi.fn().mockResolvedValue({ success: true, reset: 0 }) };
    expect(await checkRateLimit(limiter, "id")).toEqual({ allowed: true });
  });

  it("denies the request and surfaces the reset time when the limiter reports failure", async () => {
    const reset = Date.now() + 30_000;
    const limiter = { limit: vi.fn().mockResolvedValue({ success: false, reset }) };
    expect(await checkRateLimit(limiter, "id")).toEqual({ allowed: false, reset });
  });

  it("fails OPEN when the limiter throws (e.g. Upstash unreachable)", async () => {
    const limiter = { limit: vi.fn().mockRejectedValue(new Error("network error")) };
    expect(await checkRateLimit(limiter, "id")).toEqual({ allowed: true });
  });

  it("passes the identifier through to the limiter unchanged", async () => {
    const limitFn = vi.fn().mockResolvedValue({ success: true, reset: 0 });
    await checkRateLimit({ limit: limitFn }, "some-hashed-id");
    expect(limitFn).toHaveBeenCalledWith("some-hashed-id");
  });
});

describe("rateLimitedResponse", () => {
  it("returns a 429 with a retry-after header derived from the reset time", () => {
    const reset = Date.now() + 45_000;
    const res = rateLimitedResponse(reset);
    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(40);
    expect(retryAfter).toBeLessThanOrEqual(45);
  });

  it("falls back to a default retry-after when no reset time is known", () => {
    const res = rateLimitedResponse(undefined);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("never returns a retry-after below 1 second, even for an already-past reset", () => {
    const res = rateLimitedResponse(Date.now() - 10_000);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});
