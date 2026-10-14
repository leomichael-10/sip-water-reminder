import { startOfLocalDay } from "./time";

export type DayTotal = { date: string; totalMl: number };

/** Local midnight, `offsetDays` days before `now`, in `tz`. */
function dayStart(tz: string, now: Date, offsetDays: number) {
  const approx = new Date(now.getTime() - offsetDays * 86_400_000);
  return startOfLocalDay(tz, approx);
}

/**
 * Buckets logs into the last `days` local calendar days in `tz`, oldest
 * first, today last. `now` anchors "today"; today's bucket only reflects
 * logs up to `now`, which is correct — today isn't over yet.
 */
export function bucketDailyTotals(
  logs: { amountMl: number; createdAt: Date }[],
  timezone: string,
  days: number,
  now: Date
): DayTotal[] {
  const buckets: DayTotal[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = dayStart(timezone, now, i);
    const end = dayStart(timezone, now, i - 1);
    const totalMl = logs
      .filter((l) => l.createdAt >= start && l.createdAt < end)
      .reduce((sum, l) => sum + l.amountMl, 0);
    buckets.push({ date: start.toISOString().slice(0, 10), totalMl });
  }
  return buckets;
}

/**
 * Current streak of consecutive days (today backward) hitting `goalMl`.
 * Today not yet hitting the goal doesn't break the streak — the day isn't
 * over. Any earlier day that missed the goal stops the count.
 */
export function currentStreak(days: DayTotal[], goalMl: number): number {
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    const isToday = i === days.length - 1;
    if (days[i].totalMl >= goalMl) streak++;
    else if (!isToday) break;
  }
  return streak;
}
