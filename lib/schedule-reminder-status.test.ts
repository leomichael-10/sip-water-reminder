import { test } from "node:test";
import assert from "node:assert/strict";
import { reminderStatusText } from "./schedule";

const base = {
  now: new Date("2026-01-01T20:00:00Z"), // 8 PM UTC, within a 9-22 window
  enabled: true,
  timezone: "UTC",
  startHour: 9,
  endHour: 22,
  todayMl: 1000,
  goalMl: 2500,
  nextReminderAt: new Date("2026-01-01T20:10:00Z") as Date | null, // 10 min from now
  lastCronAt: new Date("2026-01-01T19:55:00Z") as Date | null, // 5 min ago, healthy
};

test("future time: shows the predicted time", () => {
  const r = reminderStatusText(base);
  assert.equal(r.text, "Next reminder around 8:10 PM");
  assert.equal(r.warning, false);
});

test("past time: shows 'any minute now' once the predicted time has just passed", () => {
  const r = reminderStatusText({ ...base, nextReminderAt: new Date("2026-01-01T19:59:00Z") }); // 1 min ago
  assert.equal(r.text, "Next reminder any minute now");
  assert.equal(r.warning, false);
});

test("past more than 20 min with a stale cron heartbeat: shows the 'not running' warning", () => {
  const r = reminderStatusText({
    ...base,
    nextReminderAt: new Date("2026-01-01T19:30:00Z"), // 30 min ago
    lastCronAt: new Date("2026-01-01T19:20:00Z"), // 40 min ago, stale
  });
  assert.equal(r.text, "Reminders aren't running. Check the cron-job.org job.");
  assert.equal(r.warning, true);
});

test("past more than 20 min but cron ran recently: no false alarm, stays on 'any minute now'", () => {
  const r = reminderStatusText({
    ...base,
    nextReminderAt: new Date("2026-01-01T19:30:00Z"), // 30 min ago (stale local snapshot)
    lastCronAt: new Date("2026-01-01T19:58:00Z"), // 2 min ago, healthy
  });
  assert.equal(r.text, "Next reminder any minute now");
  assert.equal(r.warning, false);
});

test("paused", () => {
  const r = reminderStatusText({ ...base, enabled: false });
  assert.equal(r.text, "Paused.");
  assert.equal(r.warning, false);
});

test("outside hours: shows the next window's start time with context", () => {
  const r = reminderStatusText({
    ...base,
    now: new Date("2026-01-02T03:00:00Z"), // 3 AM, outside a 9-22 window
    nextReminderAt: new Date("2026-01-02T09:00:00Z"),
  });
  assert.equal(r.text, "Outside your hours. Next reminder at 9:00 AM");
  assert.equal(r.warning, false);
});

test("goal reached", () => {
  const r = reminderStatusText({ ...base, todayMl: 2500 });
  assert.equal(r.text, "Goal reached. No more reminders today 🦋");
  assert.equal(r.warning, false);
});
