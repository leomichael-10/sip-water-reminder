import { inWindow, localHour, startOfLocalDay } from "./time";

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
  };
}
