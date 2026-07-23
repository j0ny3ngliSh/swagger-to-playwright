import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// Shared client so every endpoint's limiter and Redis writes reuse the same
// connection instead of each api/*.ts file constructing its own. A leading
// underscore keeps this directory out of Vercel's routing (it only turns
// api/*.ts files into functions, not api/_lib/*).
export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export function getIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

// Hashed rather than stored raw, so no actual IP addresses sit in Redis —
// including as rate-limit keys.
export async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Minimal shape checkRateLimit needs — matches Ratelimit's `.limit()`, but kept
// narrow so tests can pass a plain stub instead of a real Ratelimit instance.
export interface RateLimiter {
  limit(identifier: string): Promise<{ success: boolean; reset: number }>;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** Epoch ms when the window resets; present only when actually rate-limited. */
  reset?: number;
}

// One Ratelimit instance per endpoint, sharing the Redis connection above.
// `prefix` keeps each endpoint's counters in a separate Redis keyspace.
export function createLimiter(prefix: string, tokens: number, window: `${number} ${"s" | "m" | "h"}`): Ratelimit {
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(tokens, window),
    prefix: `ratelimit:${prefix}`,
    analytics: false,
  });
}

// Fails OPEN: if Upstash is unreachable or errors, the request is allowed through
// rather than the whole endpoint going down over a rate-limiter hiccup. These are
// abuse-mitigation limits on a free tool, not a security boundary — availability
// of the core feature matters more than perfect enforcement of them.
export async function checkRateLimit(limiter: RateLimiter, identifier: string): Promise<RateLimitVerdict> {
  try {
    const { success, reset } = await limiter.limit(identifier);
    return success ? { allowed: true } : { allowed: false, reset };
  } catch {
    return { allowed: true };
  }
}

export function rateLimitedResponse(reset: number | undefined): Response {
  const retryAfterSeconds = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 1000)) : 60;
  return new Response("Too many requests — please slow down.", {
    status: 429,
    headers: { "content-type": "text/plain", "retry-after": String(retryAfterSeconds) },
  });
}
