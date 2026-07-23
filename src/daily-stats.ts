export interface DailyStatsResponse {
  days: number;
  metrics: string[];
  daily: Array<Record<string, string | number>>;
}

// Scales a series of daily counts into bar heights (px) for a simple inline SVG
// chart. An all-zero series (expected for historical days before this feature
// shipped, or a metric with no activity yet) renders as flat zero-height bars
// instead of dividing by zero.
export function computeBarHeights(values: number[], maxHeightPx: number): number[] {
  const max = Math.max(0, ...values);
  if (max === 0) return values.map(() => 0);
  return values.map((v) => Math.round((v / max) * maxHeightPx));
}

// "2026-07-23" -> "07-23" — enough to distinguish days in a compact axis label
// without repeating the year on every tick.
export function shortDateLabel(isoDate: string): string {
  return isoDate.slice(5);
}
