import { inWindow, localClockLabel, localHour, localTimeToday, startOfLocalDay } from "./time";

export type ScheduleInput = {
  now: Date;
  timezone: string;
  intervalMin: number;
  startHour: number;
  endHour: number;
  goalMl: number;
  enabled: boolean;
  todayMl: number;
  lastSentAt: Date | null;
  lastLogAt: Date | null;
};

export type Decision = { send: true } | { send: false; reason: string };

// External schedulers fire a little early or late; don't skip a reminder over a minute or two.
const GRACE_MS = 2 * 60 * 1000;

/**
 * Should a reminder go out now? Logging a drink counts like a reminder,
 * so drinking on your own pushes the next nudge back by a full interval.
 */
export function shouldRemind(i: ScheduleInput): Decision {
  if (!i.enabled) return { send: false, reason: "disabled" };
  if (!inWindow(localHour(i.timezone, i.now), i.startHour, i.endHour))
    return { send: false, reason: "outside hours" };
  if (i.todayMl >= i.goalMl) return { send: false, reason: "goal reached" };

  const last = Math.max(i.lastSentAt?.getTime() ?? 0, i.lastLogAt?.getTime() ?? 0);
  if (last && i.now.getTime() - last < i.intervalMin * 60 * 1000 - GRACE_MS)
    return { send: false, reason: "too soon" };

  return { send: true };
}

/**
 * Predicts when the next reminder would go out under the current settings,
 * using the exact same eligibility rules as `shouldRemind`. Returns null if
 * no reminder will fire at all (disabled, or today's goal already reached).
 */
export function nextReminderAt(i: ScheduleInput): Date | null {
  if (!i.enabled) return null;
  if (i.todayMl >= i.goalMl) return null;

  const last = Math.max(i.lastSentAt?.getTime() ?? 0, i.lastLogAt?.getTime() ?? 0);
  const earliest = last ? last + i.intervalMin * 60 * 1000 - GRACE_MS : i.now.getTime();
  const candidate = new Date(Math.max(earliest, i.now.getTime()));

  if (inWindow(localHour(i.timezone, candidate), i.startHour, i.endHour)) return candidate;

  // Outside the active window: walk forward day by day to the next window start.
  for (let d = 0; d <= 7; d++) {
    const midnight = startOfLocalDay(i.timezone, new Date(candidate.getTime() + d * 86_400_000));
    const windowStart = new Date(midnight.getTime() + i.startHour * 60 * 60 * 1000);
    if (windowStart.getTime() >= candidate.getTime()) return windowStart;
  }
  return null;
}

const LINES = [
  "Time for a glass of water.",
  "Quick sip break?",
  "Your future self says thanks. Drink up.",
  "Hydration check. Grab some water.",
];

export function reminderMessage(todayMl: number, goalMl: number, now: Date) {
  const line = LINES[Math.floor(now.getTime() / 3_600_000) % LINES.length];
  const left = Math.max(goalMl - todayMl, 0);
  return {
    title: "Drink water 💧",
    body: `${line} ${todayMl.toLocaleString("en-US")} / ${goalMl.toLocaleString("en-US")} ml today, ${left.toLocaleString("en-US")} ml to go.`,
    url: "/?from=reminder",
    tag: "water-reminder",
  };
}

export type SupplementInput = {
  now: Date;
  timezone: string;
  timeOfDay: string; // "HH:MM", 24h local time
  enabled: boolean;
  createdAt: Date;
  takenToday: boolean;
  nudgesSentToday: number; // the caller resets this to 0 once lastNudgeAt is no longer "today"
  lastNudgeAt: Date | null;
};

const SUPPLEMENT_GRACE_MS = 2 * 60 * 1000;
const RENUDGE_AFTER_MS = 60 * 60 * 1000;
const MAX_NUDGES_PER_DAY = 2;

/**
 * Should a vitamin/supplement nudge go out right now? Up to 2 nudges/day:
 * one at the scheduled time, one re-nudge an hour later if still not taken.
 * Fully independent of water reminders — no water fields in this input.
 */
export function dueSupplement(i: SupplementInput): Decision {
  if (!i.enabled) return { send: false, reason: "disabled" };
  if (i.takenToday) return { send: false, reason: "already taken" };
  if (i.nudgesSentToday >= MAX_NUDGES_PER_DAY) return { send: false, reason: "already nudged twice today" };

  const dueAt = localTimeToday(i.timezone, i.now, i.timeOfDay);
  if (i.createdAt.getTime() > dueAt.getTime()) return { send: false, reason: "added after today's time" };
  if (i.now.getTime() + SUPPLEMENT_GRACE_MS < dueAt.getTime()) return { send: false, reason: "not yet due" };

  if (i.nudgesSentToday === 0) return { send: true };

  const elapsedSinceNudge = i.now.getTime() - (i.lastNudgeAt?.getTime() ?? 0);
  if (elapsedSinceNudge < RENUDGE_AFTER_MS - SUPPLEMENT_GRACE_MS) {
    return { send: false, reason: "too soon for re-nudge" };
  }
  return { send: true };
}

/** Filters a list of supplements down to the ones due right now. */
export function dueSupplements<T extends SupplementInput>(items: T[]): T[] {
  return items.filter((item) => dueSupplement(item).send);
}

/** Notification content for a due supplement. Its own `tag` keeps it from colliding with water reminders or other vitamins. */
export function supplementMessage(name: string, supplementId: string) {
  return {
    title: `🦋 Time for your ${name}`,
    body: `Don't forget to take your ${name}.`,
    url: "/",
    tag: `vitamin-${supplementId}`,
  };
}

export type ReminderStatusInput = {
  now: Date;
  enabled: boolean;
  timezone: string;
  startHour: number;
  endHour: number;
  todayMl: number;
  goalMl: number;
  nextReminderAt: Date | null;
  lastCronAt: Date | null;
};

export type ReminderStatus = { text: string; warning: boolean };

const CRON_STALE_MS = 20 * 60 * 1000;

/**
 * The text to show on the Reminders card for the water reminder, re-evaluated
 * client-side against a live `now` — never a stale, already-past prediction.
 */
export function reminderStatusText(i: ReminderStatusInput): ReminderStatus {
  if (!i.enabled) return { text: "Paused.", warning: false };
  if (i.todayMl >= i.goalMl) return { text: "Goal reached. No more reminders today 🦋", warning: false };
  if (!i.nextReminderAt) return { text: "Paused.", warning: false };

  const overdueMs = i.now.getTime() - i.nextReminderAt.getTime();
  const cronStale = !i.lastCronAt || i.now.getTime() - i.lastCronAt.getTime() > CRON_STALE_MS;

  if (overdueMs > CRON_STALE_MS && cronStale) {
    return { text: "Reminders aren't running. Check the cron-job.org job.", warning: true };
  }
  if (overdueMs > 0) {
    return { text: "Next reminder any minute now", warning: false };
  }

  const outsideHours = !inWindow(localHour(i.timezone, i.now), i.startHour, i.endHour);
  const label = localClockLabel(i.timezone, i.nextReminderAt);
  return {
    text: outsideHours ? `Outside your hours. Next reminder at ${label}` : `Next reminder around ${label}`,
    warning: false,
  };
}
