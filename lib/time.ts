/** Wall-clock parts of `now` in an IANA time zone. */
function localParts(tz: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localHour(tz: string, now = new Date()) {
  return localParts(tz, now).hour;
}

/** UTC instant of local midnight today in `tz`. */
export function startOfLocalDay(tz: string, now = new Date()) {
  const p = localParts(tz, now);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMs = wallAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - offsetMs);
}

/** Active window, e.g. 9–22. Supports windows that wrap past midnight (22–2). */
export function inWindow(hour: number, start: number, end: number) {
  if (start === end) return true; // all day
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** The UTC instant of `hhmm` ("HH:MM", 24h) local time, on today's local calendar date in `tz`. */
export function localTimeToday(tz: string, now: Date, hhmm: string) {
  const [hour, minute] = hhmm.split(":").map(Number);
  const midnight = startOfLocalDay(tz, now);
  return new Date(midnight.getTime() + hour * 60 * 60 * 1000 + minute * 60 * 1000);
}

/** Whether `instant` falls on the same local calendar day as `now`, in `tz`. */
export function isToday(tz: string, now: Date, instant: Date) {
  return instant.getTime() >= startOfLocalDay(tz, now).getTime();
}

/** "9:05 AM"-style clock label for an instant, in `tz`. */
export function localClockLabel(tz: string, instant: Date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(instant);
}
