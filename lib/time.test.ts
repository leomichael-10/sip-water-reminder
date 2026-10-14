import { test } from "node:test";
import assert from "node:assert/strict";
import { isToday, localTimeToday } from "./time";

test("localTimeToday turns an HH:MM local time into today's UTC instant", () => {
  const now = new Date("2026-01-01T15:00:00Z");
  const result = localTimeToday("UTC", now, "09:00");
  assert.equal(result.toISOString(), "2026-01-01T09:00:00.000Z");
});

test("localTimeToday respects a non-UTC time zone (Africa/Cairo, UTC+2 in January)", () => {
  const now = new Date("2026-01-01T15:00:00Z");
  const result = localTimeToday("Africa/Cairo", now, "09:00");
  assert.equal(result.toISOString(), "2026-01-01T07:00:00.000Z");
});

test("isToday is true for an instant on the same local calendar day", () => {
  const now = new Date("2026-01-01T15:00:00Z");
  const instant = new Date("2026-01-01T01:00:00Z");
  assert.equal(isToday("UTC", now, instant), true);
});

test("isToday is false for an instant from a previous local calendar day", () => {
  const now = new Date("2026-01-01T15:00:00Z");
  const instant = new Date("2025-12-31T23:00:00Z");
  assert.equal(isToday("UTC", now, instant), false);
});
