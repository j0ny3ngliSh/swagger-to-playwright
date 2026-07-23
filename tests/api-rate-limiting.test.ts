import { describe, it, expect, vi, beforeEach } from "vitest";

// Replaces the whole shared lib — including its `redis` export — so handler tests
// never need real Upstash credentials or network access. `checkRateLimit` is the
// dial each test turns to simulate "allowed" vs "blocked".
const { mockCheckRateLimit, mockRedis, mockGetIp, mockHashIp } = vi.hoisted(() => ({
  mockCheckRateLimit: vi.fn(),
  mockRedis: {
    sadd: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    incrby: vi.fn().mockResolvedValue(1),
    hincrby: vi.fn().mockResolvedValue(1),
  },
  mockGetIp: vi.fn().mockReturnValue("1.2.3.4"),
  mockHashIp: vi.fn().mockResolvedValue("hashed-id"),
}));

vi.mock("../api/_lib/rate-limit", () => ({
  redis: mockRedis,
  getIp: mockGetIp,
  hashIp: mockHashIp,
  createLimiter: vi.fn().mockReturnValue({ limit: vi.fn() }),
  checkRateLimit: mockCheckRateLimit,
  rateLimitedResponse: (reset?: number) => {
    const retryAfterSeconds = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 1000)) : 60;
    return new Response("Too many requests — please slow down.", {
      status: 429,
      headers: { "content-type": "text/plain", "retry-after": String(retryAfterSeconds) },
    });
  },
}));

import trackHandler from "../api/track";
import fetchSpecHandler from "../api/fetch-spec";
import subscribeHandler from "../api/subscribe";

function postJson(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("api/track rate limiting", () => {
  it("returns 429 and never touches Redis when the limiter denies", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, reset: Date.now() + 20_000 });
    const res = await trackHandler(postJson("https://x.test/api/track", { event: "visit" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(mockRedis.sadd).not.toHaveBeenCalled();
  });

  it("proceeds to record the event when the limiter allows", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    const res = await trackHandler(postJson("https://x.test/api/track", { event: "visit" }));
    expect(res.status).toBe(204);
    expect(mockRedis.sadd).toHaveBeenCalledWith("visitors:all", "hashed-id");
  });

  it("still rejects non-POST requests before ever checking the rate limit", async () => {
    const res = await trackHandler(new Request("https://x.test/api/track"));
    expect(res.status).toBe(405);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });
});

describe("api/fetch-spec rate limiting", () => {
  it("returns 429 before attempting to fetch the target URL", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, reset: Date.now() + 20_000 });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await fetchSpecHandler(
      new Request("https://x.test/api/fetch-spec?url=https://example.com/openapi.yaml"),
    );
    expect(res.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("proceeds past the rate-limit gate when allowed (reaches normal validation)", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    // No `url` param: proves we're past the gate and into the handler's own
    // validation, without needing to mock a real outbound fetch.
    const res = await fetchSpecHandler(new Request("https://x.test/api/fetch-spec"));
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toBe("Missing url param");
  });
});

describe("api/subscribe rate limiting", () => {
  it("returns 429 and never stores the email when the limiter denies", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, reset: Date.now() + 3_600_000 });
    const res = await subscribeHandler(postJson("https://x.test/api/subscribe", { email: "a@b.com" }));
    expect(res.status).toBe(429);
    expect(mockRedis.sadd).not.toHaveBeenCalled();
  });

  it("proceeds to store the email when the limiter allows", async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
    const res = await subscribeHandler(postJson("https://x.test/api/subscribe", { email: "a@b.com" }));
    expect(res.status).toBe(204);
    expect(mockRedis.sadd).toHaveBeenCalledWith("subscribers:emails", "a@b.com");
  });
});
