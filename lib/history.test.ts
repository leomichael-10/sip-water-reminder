import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketDailyTotals, currentStreak } from "./history";

const TZ = "UTC";
const NOW = new Date("2026-01-10T15:00:00Z"); // Jan 10, mid-afternoon UTC

test("bucketDailyTotals with no logs returns all-zero days, oldest first", () => {
  const days = bucketDailyTotals([], TZ, 3, NOW);
  assert.deepEqual(
    days.map((d) => d.totalMl),
    [0, 0, 0]
  );
  assert.deepEqual(
    days.map((d) => d.date),
    ["2026-01-08", "2026-01-09", "2026-01-10"]
  );
});

test("bucketDailyTotals sums each log into its own local day", () => {
  const logs = [
    { amountMl: 250, createdAt: new Date("2026-01-09T08:00:00Z") },
    { amountMl: 500, createdAt: new Date("2026-01-09T20:00:00Z") },
    { amountMl: 300, createdAt: new Date("2026-01-10T01:00:00Z") },
  ];
  const days = bucketDailyTotals(logs, TZ, 3, NOW);
  assert.deepEqual(
    days.map((d) => d.totalMl),
    [0, 750, 300]
  );
});

test("currentStreak is 0 when today and yesterday both miss the goal", () => {
  const days = bucketDailyTotals(
    [{ amountMl: 100, createdAt: new Date("2026-01-08T10:00:00Z") }],
    TZ,
    3,
    NOW
  );
  assert.equal(currentStreak(days, 2000), 0);
});

test("currentStreak counts consecutive days hitting goal, not broken by an unfinished today", () => {
  const logs = [
    { amountMl: 2000, createdAt: new Date("2026-01-08T10:00:00Z") },
    { amountMl: 2000, createdAt: new Date("2026-01-09T10:00:00Z") },
  ];
  const days = bucketDailyTotals(logs, TZ, 3, NOW);
  assert.equal(currentStreak(days, 2000), 2);
});

test("currentStreak stops at the first missed day going backward", () => {
  const logs = [
    { amountMl: 2000, createdAt: new Date("2026-01-08T10:00:00Z") },
    { amountMl: 100, createdAt: new Date("2026-01-09T10:00:00Z") }, // missed
  ];
  const days = bucketDailyTotals(logs, TZ, 3, NOW);
  assert.equal(currentStreak(days, 2000), 0);
});

test("currentStreak includes today when today already hit the goal", () => {
  const logs = [{ amountMl: 2000, createdAt: new Date("2026-01-10T10:00:00Z") }];
  const days = bucketDailyTotals(logs, TZ, 3, NOW);
  assert.equal(currentStreak(days, 2000), 1);
});
