import { redis, getIp, hashIp, createLimiter, checkRateLimit, rateLimitedResponse } from "./_lib/rate-limit";
import { lastNDates } from "./_lib/daily";

// Read-only, but still worth limiting — same generous allowance as api/track since
// legitimate use (someone reloading the dashboard) is infrequent by nature.
const statsDailyLimiter = createLimiter("stats-daily", 20, "1 m");

// Per-day distinct-visitor sets written by api/track.ts. Deliberately the same
// metrics api/stats.ts already exposes cumulatively — no new data, just a daily
// breakdown of it. Never touches subscribers:emails or feedback:missing.
const DAILY_METRIC_KEYS: Record<string, (date: string) => string> = {
  visitors: (d) => `visitors:${d}`,
  generated: (d) => `visitors:generated:${d}`,
  copied: (d) => `visitors:copied:${d}`,
  suite_downloaded: (d) => `visitors:suite_downloaded:${d}`,
  thumbs_up: (d) => `visitors:thumbs_up:${d}`,
  thumbs_down: (d) => `visitors:thumbs_down:${d}`,
  tried_sample: (d) => `visitors:tried_sample:${d}`,
  returned: (d) => `visitors:returned:${d}`,
};
const METRIC_NAMES = Object.keys(DAILY_METRIC_KEYS);

const DEFAULT_DAYS = 30;
// Matches the daily-key TTL in api/_lib/daily.ts — asking for more than this
// wouldn't return real data anyway, since older buckets have already expired.
const MAX_DAYS = 90;

export default async function handler(req: Request): Promise<Response> {
  const id = await hashIp(getIp(req));
  const { allowed, reset } = await checkRateLimit(statsDailyLimiter, id);
  if (!allowed) return rateLimitedResponse(reset);

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days"));
  const days = Number.isInteger(daysParam) && daysParam > 0 ? Math.min(daysParam, MAX_DAYS) : DEFAULT_DAYS;

  const dates = lastNDates(days);

  // One round trip for the whole grid (dates × metrics) instead of one SCARD per
  // cell — matters once `days` gets into the dozens.
  const pipeline = redis.pipeline();
  for (const date of dates) {
    for (const metric of METRIC_NAMES) {
      pipeline.scard(DAILY_METRIC_KEYS[metric](date));
    }
  }
  const counts = (await pipeline.exec<number[]>()) ?? [];

  const daily = dates.map((date, dateIndex) => {
    const row: Record<string, string | number> = { date };
    METRIC_NAMES.forEach((metric, metricIndex) => {
      row[metric] = counts[dateIndex * METRIC_NAMES.length + metricIndex] ?? 0;
    });
    return row;
  });

  return new Response(JSON.stringify({ days, metrics: METRIC_NAMES, daily }), {
    headers: { "content-type": "application/json" },
  });
}

export const config = { runtime: "edge" };
