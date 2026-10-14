import { test } from "node:test";
import assert from "node:assert/strict";
import { nextReminderAt } from "./schedule";

const base = {
  now: new Date("2026-01-01T12:00:00Z"), // noon UTC
  timezone: "UTC",
  intervalMin: 60,
  startHour: 9,
  endHour: 22,
  goalMl: 2000,
  enabled: true,
  todayMl: 0,
  lastSentAt: null as Date | null,
  lastLogAt: null as Date | null,
};

test("returns null when disabled", () => {
  assert.equal(nextReminderAt({ ...base, enabled: false }), null);
});

test("returns null when goal already reached", () => {
  assert.equal(nextReminderAt({ ...base, todayMl: 2000 }), null);
});

test("returns now when in-window with no prior reminder", () => {
  const next = nextReminderAt(base);
  assert.ok(next);
  assert.equal(next!.getTime(), base.now.getTime());
});

test("respects the interval/grace window after a recent reminder", () => {
  const lastSentAt = new Date(base.now.getTime() - 10 * 60 * 1000); // 10 min ago
  const next = nextReminderAt({ ...base, lastSentAt });
  assert.ok(next);
  const expected = lastSentAt.getTime() + 60 * 60 * 1000 - 2 * 60 * 1000;
  assert.equal(next!.getTime(), expected);
});

test("jumps to the next day's window start when currently outside a same-day window", () => {
  const now = new Date("2026-01-01T23:00:00Z"); // 23:00 UTC, window is 9-22
  const next = nextReminderAt({ ...base, now });
  assert.ok(next);
  assert.equal(next!.toISOString(), "2026-01-02T09:00:00.000Z");
});

test("handles an overnight wrap-around window (22-6)", () => {
  const now = new Date("2026-01-01T12:00:00Z"); // noon, outside a 22-6 window
  const next = nextReminderAt({ ...base, now, startHour: 22, endHour: 6 });
  assert.ok(next);
  assert.equal(next!.toISOString(), "2026-01-01T22:00:00.000Z");
});

test("never returns a time before now", () => {
  const lastSentAt = new Date(base.now.getTime() - 10_000_000 * 60 * 1000); // long ago
  const next = nextReminderAt({ ...base, lastSentAt });
  assert.ok(next);
  assert.ok(next!.getTime() >= base.now.getTime());
});
