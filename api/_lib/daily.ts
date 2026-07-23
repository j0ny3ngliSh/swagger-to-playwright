import { redis } from "./rate-limit";

// Daily keys carry their own TTL (refreshed on every write) so Redis doesn't
// grow unbounded — old buckets simply expire instead of needing a cleanup job.
export const DAILY_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

export function utcDateString(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Adds `member` to a per-day set and refreshes its TTL. Safe to call on every
// matching event — EXPIRE just resets the countdown, which is fine for a
// single-day bucket since all its writes happen within that one UTC day anyway.
export async function saddDaily(key: string, member: string): Promise<void> {
  await redis.sadd(key, member);
  await redis.expire(key, DAILY_TTL_SECONDS);
}

// Last `days` UTC date strings, oldest first, ending today — the x-axis for the
// daily stats view.
export function lastNDates(days: number): string[] {
  const dates: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    dates.push(utcDateString(d));
  }
  return dates;
}
