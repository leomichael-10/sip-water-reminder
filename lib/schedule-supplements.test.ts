import { test } from "node:test";
import assert from "node:assert/strict";
import { dueSupplement, dueSupplements, supplementMessage } from "./schedule";

const base = {
  now: new Date("2026-01-01T09:00:00Z"),
  timezone: "UTC",
  timeOfDay: "09:00",
  enabled: true,
  createdAt: new Date("2025-12-01T00:00:00Z"),
  takenToday: false,
  nudgesSentToday: 0,
  lastNudgeAt: null as Date | null,
};

test("not yet due", () => {
  const decision = dueSupplement({ ...base, now: new Date("2026-01-01T08:00:00Z") });
  assert.deepEqual(decision, { send: false, reason: "not yet due" });
});

test("due", () => {
  assert.deepEqual(dueSupplement(base), { send: true });
});

test("already taken", () => {
  assert.deepEqual(dueSupplement({ ...base, takenToday: true }), { send: false, reason: "already taken" });
});

test("disabled", () => {
  assert.deepEqual(dueSupplement({ ...base, enabled: false }), { send: false, reason: "disabled" });
});

test("not due before it was added", () => {
  const decision = dueSupplement({ ...base, createdAt: new Date("2026-01-01T12:00:00Z") });
  assert.deepEqual(decision, { send: false, reason: "added after today's time" });
});

test("re-nudge after 1h", () => {
  const lastNudgeAt = new Date("2026-01-01T09:00:00Z");
  const now = new Date(lastNudgeAt.getTime() + 60 * 60 * 1000);
  const decision = dueSupplement({ ...base, now, nudgesSentToday: 1, lastNudgeAt });
  assert.deepEqual(decision, { send: true });
});

test("no re-nudge before 1h has passed", () => {
  const lastNudgeAt = new Date("2026-01-01T09:00:00Z");
  const now = new Date(lastNudgeAt.getTime() + 30 * 60 * 1000);
  const decision = dueSupplement({ ...base, now, nudgesSentToday: 1, lastNudgeAt });
  assert.deepEqual(decision, { send: false, reason: "too soon for re-nudge" });
});

test("no third nudge", () => {
  const lastNudgeAt = new Date("2026-01-01T10:00:00Z");
  const now = new Date(lastNudgeAt.getTime() + 60 * 60 * 1000);
  const decision = dueSupplement({ ...base, now, nudgesSentToday: 2, lastNudgeAt });
  assert.deepEqual(decision, { send: false, reason: "already nudged twice today" });
});

test("time-zone correctness: Africa/Cairo 9am local is due at 7am UTC", () => {
  const now = new Date("2026-01-01T07:00:00Z");
  const decision = dueSupplement({ ...base, now, timezone: "Africa/Cairo" });
  assert.deepEqual(decision, { send: true });
});

test("time-zone correctness: not yet due in Africa/Cairo", () => {
  const now = new Date("2026-01-01T06:00:00Z");
  const decision = dueSupplement({ ...base, now, timezone: "Africa/Cairo" });
  assert.deepEqual(decision, { send: false, reason: "not yet due" });
});

test("dueSupplements filters a mixed list down to the ones that are due", () => {
  const items = [
    { ...base, id: "a" },
    { ...base, id: "b", takenToday: true },
    { ...base, id: "c", now: new Date("2026-01-01T08:00:00Z") },
  ];
  assert.deepEqual(dueSupplements(items).map((i) => i.id), ["a"]);
});

test("supplementMessage builds a title, body, and a per-supplement tag", () => {
  const msg = supplementMessage("Multivitamin", "supp_123");
  assert.equal(msg.title, "🦋 Time for your Multivitamin");
  assert.equal(msg.tag, "vitamin-supp_123");
  assert.equal(msg.url, "/");
});
