# Sip Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optimistic updates, offline-friendly local caching, a 7-day history chart with streak, a custom amount input, a predicted next-reminder time, system-following light mode, and a goal-reached celebration — on top of the already-fixed loading bug.

**Architecture:** Keep the existing single-page client component (`app/page.tsx`) as the UI host. Pure, testable logic (streak/history bucketing, next-reminder prediction) lives in `lib/`, following the existing `lib/schedule.ts` / `lib/time.ts` pattern. One new API route (`/api/history`) follows the existing route conventions in `app/api/*`. No state management library, no chart library, no new UI framework.

**Tech Stack:** Next.js 15 App Router, Prisma 6 + Neon Postgres, Tailwind v4 (CSS-variable theming), plain SVG for the chart, `node:test` + `tsx` (new, lightweight devDependency) for pure-function tests.

**Spec:** User-provided task description (see conversation); no separate spec file.

## Global Constraints

- Keep the stack: Next.js App Router, Prisma, Tailwind v4, web-push. No new runtime dependencies. Draw the chart with plain SVG.
- `lib/schedule.ts` stays pure (no I/O, no `Date.now()` — always takes `now` as a parameter). Add tests for any new timing logic.
- Must keep working as an iOS Home Screen PWA (iOS 16.4+): all text inputs 16px, safe-area insets respected, no hover-only interactions.
- `npm run build` must pass with no type errors at the end.
- Commit in small, clear commits; push to `origin main` after each task (or logical group).

## Tasks 0a–0d: Close out the original bug report before touching improvements

These were added after the user re-raised the original bug report mid-plan. 0a and 0b were already completed and pushed (commit `3440906`, "Fix infinite loading screen and add health check") before this plan file existed; they're recorded here for traceability, not re-done.

- **0a — Root cause.** `.env` didn't exist at all (only `.env.example`), so `DATABASE_URL`/`NEXT_PUBLIC_VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`/`CRON_SECRET` were all unset. Confirmed via the dev server log: `PrismaClientInitializationError: Environment variable not found: DATABASE_URL.` `.env` now has all five values (VAPID keys and `CRON_SECRET` generated locally; `DATABASE_URL` is the user's real Neon connection string). `npx prisma db push` could not be verified end-to-end in this environment — AVG Antivirus's firewall resets outbound TLS on port 5432 on this machine specifically (confirmed: TLS to the same host on port 443 works fine; the reset reproduces identically via Node, OpenSSL, and raw .NET `SslStream`, so it isn't a credentials or Prisma issue). The user chose to skip local DB verification rather than adjust AVG. **Status: done, re-verified below.**
- **0b — Error screen + timeout.** Done in the same commit: `loadState()` is retryable, wrapped in a 10s `AbortController` timeout, and a dedicated error screen with a "Try again" button replaces the endless "Pouring…" when the initial load fails. **Status: done.**
- **0c — `GET /api/health`.** Already existed from the same commit, but with field names `{ db, vapid, cronSecret }`. The user has now specified exact names: `{ dbOk, vapidConfigured, cronSecretSet }` (booleans only, never values). **Status: renaming now, this round.**
- **0d — Visible errors on the Reminders card.** `turnOnReminders` and `test` already flash a toast on failure, but a toast is ephemeral and easy to miss on an iPhone. Add a persistent inline error message on the Reminders card itself, cleared on the next successful action, so a failed subscribe or test push doesn't go unnoticed. **Status: new work, this round.**

- [ ] **0c Step 1:** Rename `app/api/health/route.ts`'s response fields from `{ db, vapid, cronSecret }` to `{ dbOk, vapidConfigured, cronSecretSet }`.
- [ ] **0c Step 2:** Re-run `npx prisma db push` once more (cheap, non-destructive check in case anything changed), and re-hit `/api/health` and `/api/state` to confirm current status.
- [ ] **0d Step 1:** Add a `pushError` state to `app/page.tsx`, set it in the `catch` blocks of `turnOnReminders` and `test` (in addition to the existing `flash(...)` call, not instead of it), clear it on entry to those functions and on `loadState` success.
- [ ] **0d Step 2:** Render `pushError` inside the Reminders card, styled distinctly from the toast (e.g. a small red-tinted inline message), below whichever `push` status block is showing.
- [ ] **Commit and report:** `npm run build`, commit, then give the user the Vercel env var checklist and cron-job.org setup steps, and stop for them to deploy and confirm a real notification arrives on their iPhone before continuing to Task 1.

---

## Review Focus

- **Optimistic rollback correctness** — if `POST /api/log` fails (e.g. a rejected amount), the UI must restore the exact prior state, not just undo the delta, or `todayMl`/`logs` can drift from the server's truth.
- **`localStorage` unavailable** (Safari private mode, quota exceeded, or SSR with no `window`) — cache reads/writes must never throw and must never block rendering.
- **Brand-new device with zero logs ever** — `/api/history` and the bucketing/streak functions must handle an empty log list without throwing, returning all-zero days and `streak: 0`.
- **`nextReminderAt` with a wrap-around window** (e.g. `startHour=22, endHour=6`) and "now" near the boundary — must return a time at or after `now`, never in the past, and must terminate (bounded iteration).
- **Custom amount input with invalid input** (`"abc"`, `"-5"`, `"99999"`, `"12.7"`, empty) — must be rejected client-side with feedback, matching the server's own `1–3000` clamp in `app/api/log/route.ts:11-14`, instead of silently sending a value the server will quietly change.

---

## Task 1: Test runner setup

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `npm test` command that later tasks' tests run under.

- [ ] **Step 1: Add `tsx` as a devDependency**

```bash
npm install -D tsx
```

- [ ] **Step 2: Add the test script**

Open `package.json` and add a `"test"` entry to `"scripts"` (keep all existing scripts):

```json
"scripts": {
  "dev": "next dev",
  "build": "prisma generate && next build",
  "start": "next start",
  "postinstall": "prisma generate",
  "db:push": "prisma db push",
  "vapid": "web-push generate-vapid-keys",
  "test": "node --import tsx --test lib/schedule.test.ts lib/history.test.ts"
},
```

(This list of test files is updated in Tasks 2 and 3 below as those files are created — it's deliberately explicit rather than a glob, because `**` globs aren't reliably expanded by every shell on Windows, and Node's own directory-arg discovery doesn't play well with the `tsx` loader hook.)

- [ ] **Step 3: Verify the command runs (with zero test files it's a no-op but must not error)**

Run: `npm test`
Expected: Node reports a "Cannot find module" error for `lib/schedule.test.ts` — that's fine, it confirms the command itself is wired correctly. Task 2 creates that file next.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add tsx-based test runner for pure lib functions"
```

---

## Task 2: `nextReminderAt` in `lib/schedule.ts`

**Files:**
- Modify: `lib/schedule.ts`
- Create: `lib/schedule.test.ts`

**Interfaces:**
- Consumes: existing `ScheduleInput` type, `inWindow`/`localHour` from `./time`, module-level `GRACE_MS` — all already in `lib/schedule.ts`.
- Produces: `export function nextReminderAt(i: ScheduleInput): Date | null` — the predicted next reminder instant, or `null` if no reminder will ever fire under the current settings (disabled, or goal already reached). Consumed by Task 6 (`lib/device.ts`).

- [ ] **Step 1: Write the failing tests**

Create `lib/schedule.test.ts`:

```typescript
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
  // earliest eligible instant = lastSentAt + 60min - 2min grace
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `nextReminderAt` is not exported from `./schedule`.

- [ ] **Step 3: Implement `nextReminderAt`**

In `lib/schedule.ts`, add this function after `shouldRemind` (keep the existing `import { inWindow, localHour } from "./time";` line, but change it to also import `startOfLocalDay`):

```typescript
import { inWindow, localHour, startOfLocalDay } from "./time";
```

Then add, right after the closing brace of `shouldRemind`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all 7 tests in `lib/schedule.test.ts` pass (the `lib/history.test.ts` entry will still fail to resolve until Task 3 — that's expected at this point).

- [ ] **Step 5: Commit**

```bash
git add lib/schedule.ts lib/schedule.test.ts
git commit -m "Add nextReminderAt to lib/schedule.ts"
```

---

## Task 3: `lib/history.ts` — daily bucketing and streak

**Files:**
- Create: `lib/history.ts`
- Create: `lib/history.test.ts`

**Interfaces:**
- Consumes: `startOfLocalDay` from `./time`.
- Produces: `export type DayTotal = { date: string; totalMl: number }`, `export function bucketDailyTotals(logs: { amountMl: number; createdAt: Date }[], timezone: string, days: number, now: Date): DayTotal[]`, `export function currentStreak(days: DayTotal[], goalMl: number): number`. Consumed by Task 5 (`app/api/history/route.ts`).

- [ ] **Step 1: Write the failing tests**

Create `lib/history.test.ts`:

```typescript
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
    // no log yet today (Jan 10)
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot find module `./history`.

- [ ] **Step 3: Implement `lib/history.ts`**

```typescript
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
```

- [ ] **Step 4: Update the test script to include this file (if not already listed from Task 1)**

Confirm `package.json`'s `"test"` script already includes `lib/history.test.ts` (it does, from Task 1 — no change needed here).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all tests in both `lib/schedule.test.ts` and `lib/history.test.ts` pass (13 total).

- [ ] **Step 6: Commit**

```bash
git add lib/history.ts lib/history.test.ts
git commit -m "Add lib/history.ts for daily bucketing and streak calculation"
```

---

## Task 4: Shared types in `lib/types.ts`

**Files:**
- Create: `lib/types.ts`
- Modify: `app/page.tsx:5-19` (remove local `Settings`/`State` type declarations, import from `lib/types` instead)

**Interfaces:**
- Produces: `export type Settings`, `export type LogEntry`, `export type State`, `export type HistoryDay`, `export type History`. Consumed by `app/page.tsx`, `lib/stateCache.ts` (Task 7), `app/history-chart.tsx` (Task 11), `app/api/history/route.ts` (Task 5), `lib/device.ts` (Task 6).

- [ ] **Step 1: Create `lib/types.ts`**

```typescript
export type Settings = {
  timezone: string;
  intervalMin: number;
  startHour: number;
  endHour: number;
  goalMl: number;
  glassMl: number;
  enabled: boolean;
};

export type LogEntry = { id: string; amountMl: number; at: string };

export type State = {
  settings: Settings;
  todayMl: number;
  logs: LogEntry[];
  subscribed: boolean;
  nextReminderAt: string | null;
};

export type HistoryDay = { date: string; totalMl: number };

export type History = {
  days: HistoryDay[];
  goalMl: number;
  streak: number;
};
```

- [ ] **Step 2: Update `app/page.tsx` to import these types instead of declaring them locally**

Replace lines 5-19 of `app/page.tsx` (the local `Settings`/`State` type declarations):

```typescript
type Settings = {
  timezone: string;
  intervalMin: number;
  startHour: number;
  endHour: number;
  goalMl: number;
  glassMl: number;
  enabled: boolean;
};
type State = {
  settings: Settings;
  todayMl: number;
  logs: { id: string; amountMl: number; at: string }[];
  subscribed: boolean;
};
```

with:

```typescript
import type { Settings, State } from "@/lib/types";
```

(Place this new import line alongside the existing `import { useCallback, ... } from "react";` line at the top of the file — both become part of the file's import block.)

- [ ] **Step 3: Verify the build still type-checks**

Run: `npx tsc --noEmit`
Expected: no errors. (`State` gains a `nextReminderAt: string | null` field here, but `app/page.tsx`'s `api()` helper has no declared return type — so `let s: State = await api(...)` is a bare type annotation TypeScript won't cross-check against the real response shape. This step only confirms the import itself resolves correctly; the actual server response doesn't include `nextReminderAt` yet until Task 6, which is a separate, runtime-only gap this step can't catch.)

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts app/page.tsx
git commit -m "Extract shared State/Settings types to lib/types.ts"
```

---

## Task 5: `GET /api/history`

**Files:**
- Create: `app/api/history/route.ts`

**Interfaces:**
- Consumes: `bad`, `getOrCreateDevice`, `validDeviceId` from `@/lib/device`; `bucketDailyTotals`, `currentStreak` from `@/lib/history`; `prisma` from `@/lib/db`.
- Produces: `GET /api/history?deviceId=...` → `History` JSON (as defined in `lib/types.ts`). Consumed by `app/page.tsx` (Task 11).

- [ ] **Step 1: Create the route**

```typescript
import { prisma } from "@/lib/db";
import { bad, getOrCreateDevice, validDeviceId } from "@/lib/device";
import { bucketDailyTotals, currentStreak } from "@/lib/history";

export const dynamic = "force-dynamic";

const LOOKBACK_DAYS = 30;
const CHART_DAYS = 7;

/** Last 7 days of totals for the chart, plus a streak computed over a longer lookback. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("deviceId");
  if (!validDeviceId(id)) return bad("invalid deviceId");
  const device = await getOrCreateDevice(id);

  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);
  const logs = await prisma.waterLog.findMany({
    where: { deviceId: id, createdAt: { gte: since } },
    select: { amountMl: true, createdAt: true },
  });

  const allDays = bucketDailyTotals(logs, device.timezone, LOOKBACK_DAYS, now);
  return Response.json({
    days: allDays.slice(-CHART_DAYS),
    goalMl: device.goalMl,
    streak: currentStreak(allDays, device.goalMl),
  });
}
```

- [ ] **Step 2: Manually verify against a running dev server**

Run: `npm run dev`, then in another terminal: `curl "http://localhost:3000/api/history?deviceId=test-device-123"`
Expected (once `DATABASE_URL` is reachable): a 200 response shaped like `{"days":[{"date":"...","totalMl":0}, ...7 entries...],"goalMl":2500,"streak":0}`. If the database isn't reachable in this environment, confirm instead that the route compiles (`✓ Compiled /api/history ...` in the dev server log) and returns a 500 rather than a crash that kills the server.

- [ ] **Step 3: Commit**

```bash
git add app/api/history/route.ts
git commit -m "Add GET /api/history endpoint"
```

---

## Task 6: Wire `nextReminderAt` into `/api/state`

**Files:**
- Modify: `lib/device.ts`

**Interfaces:**
- Consumes: `nextReminderAt` from `./schedule` (Task 2).
- Produces: `deviceState()` now returns a `State` (per `lib/types.ts`) including `nextReminderAt: string | null`. Consumed by `app/page.tsx` (Task 10).

- [ ] **Step 1: Update `lib/device.ts`**

Replace the full contents of `lib/device.ts` with:

```typescript
import { prisma } from "./db";
import { nextReminderAt } from "./schedule";
import { startOfLocalDay } from "./time";

const ID_RE = /^[a-zA-Z0-9-]{8,64}$/;

export function validDeviceId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

export async function getOrCreateDevice(id: string) {
  return prisma.device.upsert({ where: { id }, update: {}, create: { id } });
}

export async function todayLogs(deviceId: string, tz: string) {
  return prisma.waterLog.findMany({
    where: { deviceId, createdAt: { gte: startOfLocalDay(tz) } },
    orderBy: { createdAt: "desc" },
  });
}

export async function deviceState(id: string) {
  const device = await getOrCreateDevice(id);
  const now = new Date();
  const [logs, subCount, lastLog] = await Promise.all([
    todayLogs(id, device.timezone),
    prisma.pushSubscription.count({ where: { deviceId: id } }),
    prisma.waterLog.findFirst({ where: { deviceId: id }, orderBy: { createdAt: "desc" } }),
  ]);
  const todayMl = logs.reduce((s, l) => s + l.amountMl, 0);
  const next = nextReminderAt({
    now,
    timezone: device.timezone,
    intervalMin: device.intervalMin,
    startHour: device.startHour,
    endHour: device.endHour,
    goalMl: device.goalMl,
    enabled: device.enabled,
    todayMl,
    lastSentAt: device.lastSentAt,
    lastLogAt: lastLog?.createdAt ?? null,
  });

  return {
    settings: {
      timezone: device.timezone,
      intervalMin: device.intervalMin,
      startHour: device.startHour,
      endHour: device.endHour,
      goalMl: device.goalMl,
      glassMl: device.glassMl,
      enabled: device.enabled,
    },
    todayMl,
    logs: logs.map((l) => ({ id: l.id, amountMl: l.amountMl, at: l.createdAt.toISOString() })),
    subscribed: subCount > 0,
    nextReminderAt: next ? next.toISOString() : null,
  };
}

export const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status });
```

(This is a pure addition to the existing shape — `todayLogs`, `validDeviceId`, `getOrCreateDevice`, and `bad` are unchanged, so every other route that imports them keeps working.)

- [ ] **Step 2: Verify the type-check from Task 4 now passes clean**

Run: `npx tsc --noEmit`
Expected: no errors (the `nextReminderAt` field that `app/page.tsx`'s `State` type expects is now actually present in every `deviceState()` response).

- [ ] **Step 3: Commit**

```bash
git add lib/device.ts
git commit -m "Include predicted nextReminderAt in deviceState()"
```

---

## Task 7: `localStorage` state cache

**Files:**
- Create: `lib/stateCache.ts`
- Modify: `app/page.tsx` (the `loadState` callback, and every other place that calls `setState(await api(...))` with a canonical server response)

**Interfaces:**
- Consumes: `State` from `@/lib/types`.
- Produces: `export function readCachedState(): State | null`, `export function writeCachedState(state: State): void`. Consumed by `app/page.tsx`.

- [ ] **Step 1: Create `lib/stateCache.ts`**

```typescript
import type { State } from "./types";

const KEY = "sip-state-cache";

/** Never throws — returns null on any failure (private mode, corrupt JSON, SSR). */
export function readCachedState(): State | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as State) : null;
  } catch {
    return null;
  }
}

/** Never throws — silently drops the write on any failure (private mode, quota). */
export function writeCachedState(state: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}
```

- [ ] **Step 2: Wire it into `app/page.tsx`**

Add the import near the top of `app/page.tsx`, alongside the `lib/types` import added in Task 4:

```typescript
import { readCachedState, writeCachedState } from "@/lib/stateCache";
```

Inside the component, right after the `flash` function definition and before `loadState`, add a small helper that both sets state and keeps the cache in sync:

```typescript
const commit = (s: State) => {
  setState(s);
  writeCachedState(s);
};
```

In `loadState`, read the cache synchronously before the network call, and use `commit` instead of `setState` for the canonical server response:

```typescript
const loadState = useCallback(async () => {
  setLoadError("");
  const id = getDeviceId();
  setDeviceId(id);
  setFromReminder(new URLSearchParams(location.search).get("from") === "reminder");

  const cached = readCachedState();
  if (cached) setState(cached);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  try {
    let s: State = await api(`/api/state?deviceId=${id}`, "GET", undefined, controller.signal);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== s.settings.timezone) s = await api("/api/settings", "PUT", { deviceId: id, timezone: tz });
    commit(s);
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPush(isIOS() && !isStandalone() ? "install" : "unsupported");
      return;
    }
    await navigator.serviceWorker.register("/sw.js");
    if (Notification.permission === "denied") setPush("denied");
    else if (Notification.permission === "granted" && s.subscribed) setPush("on");
    else setPush("ask");
  } catch (e) {
    const err = e as Error;
    const message = err.name === "AbortError" ? "Taking too long to load. Check your connection and try again." : err.message;
    if (cached) flash(message); // keep showing the stale cache, just surface the refresh failure
    else setLoadError(message);
  } finally {
    clearTimeout(timer);
  }
}, []);
```

Update the three other places that do `setState(await api(...))` with a canonical server response to use `commit` instead, so the cache never goes stale after a mutation: in `turnOnReminders` (the `setState(await api("/api/subscribe", ...))` line), in `undo` (the `setState(await api("/api/log", "DELETE", ...))` line), and in `save` (the `setState(await api("/api/settings", "PUT", ...))` line — but leave save's earlier optimistic `setState({ ...state, settings: ... })` line as plain `setState`, not `commit`, since that's a provisional value, not the server's canonical one).

- [ ] **Step 3: Manually verify**

Run: `npm run build && npm start`, open `http://localhost:3000` in a browser once, confirm `localStorage.getItem("sip-state-cache")` in devtools returns the cached JSON after the page loads successfully. Reload with the network tab set to "Offline" — confirm the glass/today's total render immediately from cache instead of showing the loading screen (a toast or the existing error path may still appear once the background refresh fails, which is expected).

- [ ] **Step 4: Commit**

```bash
git add lib/stateCache.ts app/page.tsx
git commit -m "Cache last state in localStorage so the app opens instantly"
```

---

## Task 8: Optimistic updates for logging a drink

**Files:**
- Modify: `app/page.tsx` (the `drink` callback)

**Interfaces:**
- Consumes: `commit` helper and `state` (Task 7).
- Produces: unchanged `drink(amountMl?: number)` signature — behavior only.

- [ ] **Step 1: Replace the `drink` callback**

Replace the existing `drink` callback in `app/page.tsx`:

```typescript
const drink = useCallback(
  async (amountMl?: number) => {
    if (!deviceId) return;
    if ("vibrate" in navigator) navigator.vibrate?.(10);
    try {
      setState(await api("/api/log", "POST", { deviceId, amountMl }));
      setFromReminder(false);
    } catch (e) {
      flash((e as Error).message);
    }
  },
  [deviceId]
);
```

with:

```typescript
const drink = useCallback(
  async (amountMl?: number) => {
    if (!deviceId || !state) return;
    if ("vibrate" in navigator) navigator.vibrate?.(10);
    const amount = amountMl ?? state.settings.glassMl;
    const previous = state;
    const optimisticLog = { id: `pending-${Date.now()}`, amountMl: amount, at: new Date().toISOString() };
    setState({ ...state, todayMl: state.todayMl + amount, logs: [optimisticLog, ...state.logs] });
    setFromReminder(false);
    try {
      commit(await api("/api/log", "POST", { deviceId, amountMl }));
    } catch (e) {
      setState(previous);
      flash((e as Error).message);
    }
  },
  [deviceId, state]
);
```

- [ ] **Step 2: Manually verify optimistic update and rollback**

Run: `npm run dev`. In the browser, tap "+1 glass" — confirm the glass fill and total jump immediately (before any network round-trip completes; throttle the network in devtools to "Slow 3G" to see the gap clearly). Then, with devtools' network tab set to "Offline", tap "+1 glass" again — confirm the optimistic bump appears for a moment and then reverts back to the prior total once the request fails, with a toast showing the error.

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "Optimistic update for logging a drink, with rollback on failure"
```

---

## Task 9: Custom amount input

**Files:**
- Modify: `app/page.tsx` (new state + handler, new UI in the "Log buttons" section)

**Interfaces:**
- Consumes: `drink` (Task 8), `flash`.

- [ ] **Step 1: Add state and a handler**

Add a new piece of state alongside the other `useState` calls near the top of the component:

```typescript
const [customMl, setCustomMl] = useState("");
```

Add a handler after the `drink` callback:

```typescript
const addCustom = () => {
  const amount = Math.round(Number(customMl));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 3000) {
    flash("Enter an amount between 1 and 3000 ml.");
    return;
  }
  drink(amount);
  setCustomMl("");
};
```

(The `1`–`3000` bounds mirror the server's own clamp in `app/api/log/route.ts:11-14`, so a value the UI accepts is never silently altered by the server.)

- [ ] **Step 2: Add the input to the "Log buttons" section**

In the JSX, inside the `{/* Log buttons */}` section, after the existing `<div className="mt-3 grid grid-cols-3 gap-3">...</div>` block, add:

```tsx
<div className="mt-3 flex gap-2">
  <input
    type="number"
    inputMode="numeric"
    min={1}
    max={3000}
    placeholder="Custom ml"
    value={customMl}
    onChange={(e) => setCustomMl(e.target.value)}
    className="sel flex-1"
  />
  <button
    onClick={addCustom}
    className="rounded-2xl bg-deep px-5 py-3 font-medium active:scale-95"
  >
    Add
  </button>
</div>
```

(Reusing the existing `.sel` class from `app/globals.css` keeps the 16px font-size iOS rule and the dark/light theme colors consistent with the rest of the UI, with no new CSS needed.)

- [ ] **Step 3: Manually verify**

Run: `npm run dev`. Type `350` into the custom field and tap "Add" — confirm it logs exactly 350ml. Try `abc`, `-5`, `9999`, and an empty value — confirm each shows the "Enter an amount between 1 and 3000 ml." toast instead of logging anything.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "Add custom amount input for logging a drink"
```

---

## Task 10: "Next reminder around HH:MM"

**Files:**
- Modify: `app/page.tsx` (Reminders card JSX)

**Interfaces:**
- Consumes: `state.nextReminderAt` (Task 6), existing `timeLabel` helper.

- [ ] **Step 1: Add the line to the Reminders card**

In the `{push === "on" && (...)}` block, after the existing description `<p className="text-foam/80">...</p>`, add:

```tsx
{s.enabled && state.nextReminderAt && (
  <p className="text-foam/60">Next reminder around {timeLabel(state.nextReminderAt)}</p>
)}
```

(`timeLabel` already exists at the top of the file and formats an ISO string using the viewer's local time — the same helper used for the "Today" log list.)

- [ ] **Step 2: Manually verify**

Run: `npm run dev`, turn reminders on, and confirm the Reminders card shows a "Next reminder around H:MM AM/PM" line. Pause reminders (tap "Pause") and confirm the line disappears (since `s.enabled` is false).

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "Show predicted next reminder time on the Reminders card"
```

---

## Task 11: 7-day history view with SVG chart and streak

**Files:**
- Create: `app/history-chart.tsx`
- Modify: `app/page.tsx` (new state, a toggle button in the header, a new section)

**Interfaces:**
- Consumes: `History` from `@/lib/types` (Task 4), `/api/history` (Task 5).
- Produces: `export function HistoryChart({ history }: { history: History }): JSX.Element` in `app/history-chart.tsx`, consumed by `app/page.tsx`.

- [ ] **Step 1: Create the chart component**

```tsx
import type { History } from "@/lib/types";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WIDTH = 280;
const HEIGHT = 120;
const BAR_GAP = 8;

export function HistoryChart({ history }: { history: History }) {
  const { days, goalMl, streak } = history;
  const max = Math.max(goalMl, ...days.map((d) => d.totalMl), 1);
  const barWidth = (WIDTH - BAR_GAP * (days.length - 1)) / days.length;
  const goalY = HEIGHT - (goalMl / max) * HEIGHT;

  return (
    <div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" height={HEIGHT} role="img" aria-label="Water intake, last 7 days">
        <line x1={0} y1={goalY} x2={WIDTH} y2={goalY} stroke="currentColor" className="text-foam/30" strokeDasharray="4 4" strokeWidth={1} />
        {days.map((d, i) => {
          const barHeight = (d.totalMl / max) * HEIGHT;
          const x = i * (barWidth + BAR_GAP);
          const hitGoal = d.totalMl >= goalMl;
          return (
            <rect
              key={d.date}
              x={x}
              y={HEIGHT - barHeight}
              width={barWidth}
              height={barHeight}
              rx={4}
              className={hitGoal ? "fill-water" : "fill-foam/30"}
            />
          );
        })}
      </svg>
      <div className="mt-1 flex text-xs text-foam/50" style={{ gap: `${BAR_GAP}px` }}>
        {days.map((d) => (
          <span key={d.date} style={{ width: `${barWidth}px` }} className="text-center">
            {WEEKDAY[new Date(`${d.date}T00:00:00Z`).getUTCDay()]}
          </span>
        ))}
      </div>
      <p className="mt-3 text-sm text-foam/80">
        {streak > 0 ? `🔥 ${streak} day${streak === 1 ? "" : "s"} hitting your goal` : "Hit your goal today to start a streak."}
      </p>
    </div>
  );
}
```

(`barWidth` is computed once from a fixed `WIDTH`/`days.length`, so this only renders correctly for the 7-day case the API returns — matching YAGNI, since nothing else requests a different day count.)

- [ ] **Step 2: Wire it into `app/page.tsx`**

Add the import:

```typescript
import { HistoryChart } from "./history-chart";
import type { History } from "@/lib/types";
```

Add state alongside `showSettings`:

```typescript
const [showHistory, setShowHistory] = useState(false);
const [history, setHistory] = useState<History | null>(null);
```

Add a toggle handler after `save`:

```typescript
const toggleHistory = async () => {
  setShowHistory((v) => !v);
  if (!history && deviceId) {
    try {
      setHistory(await api(`/api/history?deviceId=${deviceId}`));
    } catch (e) {
      flash((e as Error).message);
    }
  }
};
```

In the header, add a second button next to "Settings" (wrap both in a flex row):

```tsx
<header className="flex items-center justify-between">
  <h1 className="text-2xl font-bold tracking-tight">Sip</h1>
  <div className="flex gap-2">
    <button
      onClick={toggleHistory}
      className="rounded-full bg-deep px-4 py-2 text-sm font-medium text-foam/80 active:scale-95"
    >
      {showHistory ? "Done" : "History"}
    </button>
    <button
      onClick={() => setShowSettings((v) => !v)}
      className="rounded-full bg-deep px-4 py-2 text-sm font-medium text-foam/80 active:scale-95"
    >
      {showSettings ? "Done" : "Settings"}
    </button>
  </div>
</header>
```

Add the history section right after the `{/* Settings */}` section's closing `)}`:

```tsx
{/* History */}
{showHistory && (
  <section className="mt-4 rounded-3xl bg-deep p-5">
    <h2 className="font-semibold">Last 7 days</h2>
    {history ? (
      <div className="mt-3">
        <HistoryChart history={history} />
      </div>
    ) : (
      <p className="mt-2 text-sm text-foam/60">Loading…</p>
    )}
  </section>
)}
```

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, log a few drinks, tap "History" — confirm 7 bars render with today's bar on the right, a dashed goal line, and the streak line underneath. Toggle it closed and open again — confirm it doesn't re-fetch (the "Loading…" flash only happens once).

- [ ] **Step 4: Commit**

```bash
git add app/history-chart.tsx app/page.tsx
git commit -m "Add 7-day history chart with goal line and streak"
```

---

## Task 12: Light mode following system setting

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx:11-16`

**Interfaces:** none (CSS/metadata only — no component code changes).

- [ ] **Step 1: Add light-theme token overrides to `app/globals.css`**

After the existing `@theme { ... }` block in `app/globals.css`, add:

```css
@media (prefers-color-scheme: light) {
  :root {
    --color-ink: #eef6fb;
    --color-deep: #dbeafe;
    --color-water: #0284c7;
    --color-foam: #0b1e33;
  }
}
```

(These four custom properties are the only color source for every `bg-*`/`text-*`/`border-*` utility in the app — Tailwind v4's `@theme` block makes each utility reference the CSS variable rather than inlining its value, so overriding them here re-themes the whole UI with zero component changes. Each name keeps its structural *role* — `ink` = page background, `deep` = card background, `water` = accent, `foam` = primary foreground — while its literal color flips for light mode. This is why elements that intentionally invert foreground/background in the dark theme, like the "Turn on reminders" button (`bg-foam text-ink`), keep the same *relative* contrast in light mode instead of breaking.)

- [ ] **Step 2: Add matching theme-color meta tags in `app/layout.tsx`**

Replace the `viewport` export in `app/layout.tsx`:

```typescript
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b1e33",
};
```

with:

```typescript
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0b1e33" },
    { media: "(prefers-color-scheme: light)", color: "#eef6fb" },
  ],
};
```

- [ ] **Step 3: Manually verify in a browser**

Run: `npm run dev`, open the app, and toggle the OS/browser color-scheme preference (in Chrome devtools: Rendering tab → "Emulate CSS media feature prefers-color-scheme"). Confirm the whole UI re-themes — background, cards, text, the "Turn on reminders" pill, the glass border — with no illegible or low-contrast combinations, and confirm it defaults to the existing dark look when no light preference is set.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css app/layout.tsx
git commit -m "Add light theme that follows the system color scheme"
```

---

## Task 13: Goal-reached celebration

**Files:**
- Modify: `app/globals.css`
- Modify: `app/page.tsx` (new effect + state, new render block)

**Interfaces:** none new — purely additive state/effect in the existing component.

- [ ] **Step 1: Add the animation to `app/globals.css`**

After the existing `.wave` rule and its reduced-motion override, add:

```css
@keyframes celebrate-pop {
  0% { transform: scale(0.4) rotate(-8deg); opacity: 0; }
  40% { transform: scale(1.15) rotate(4deg); opacity: 1; }
  70% { transform: scale(1) rotate(0deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 0; }
}
.celebrate { animation: celebrate-pop 1.6s ease-out forwards; }
@media (prefers-reduced-motion: reduce) {
  .celebrate { animation: none; opacity: 1; }
}
```

- [ ] **Step 2: Add detection + render in `app/page.tsx`**

Add `useRef` to the existing React import:

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
```

Add state and a ref alongside the other `useState` calls:

```typescript
const [celebrate, setCelebrate] = useState(false);
const wasDoneRef = useRef(false);
```

Add two effects after the `pct` memo (which already depends on `state`):

```typescript
useEffect(() => {
  if (!state) return;
  const nowDone = state.todayMl >= state.settings.goalMl;
  if (nowDone && !wasDoneRef.current) setCelebrate(true);
  wasDoneRef.current = nowDone;
}, [state]);

useEffect(() => {
  if (!celebrate) return;
  const t = setTimeout(() => setCelebrate(false), 1800);
  return () => clearTimeout(t);
}, [celebrate]);
```

Add the render block right after the opening `<main ...>` tag of the main return (before the `<header>`):

```tsx
{celebrate && (
  <div className="pointer-events-none fixed inset-0 grid place-items-center" aria-hidden="true">
    <span className="celebrate text-7xl">🎉</span>
  </div>
)}
```

- [ ] **Step 3: Manually verify, including reduced motion**

Run: `npm run dev`. Log drinks until you hit the daily goal — confirm the 🎉 pops in, scales/rotates briefly, and fades out after under 2 seconds, without blocking any taps underneath (`pointer-events-none`). Then enable "prefers reduced motion" in your OS accessibility settings (or devtools' Rendering tab → "Emulate CSS media feature prefers-reduced-motion: reduce") and repeat — confirm the emoji still appears and disappears on the same timer, but without the scale/rotate animation.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css app/page.tsx
git commit -m "Add goal-reached celebration, respecting prefers-reduced-motion"
```

---

## Task 14: Final verification and push

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests across `lib/schedule.test.ts` and `lib/history.test.ts` pass.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: completes with no type errors, listing `/api/history` among the routes.

- [ ] **Step 3: Smoke-test the running app**

Run: `npm start`, open `http://localhost:3000`, and walk through: initial load, logging a drink (+1 glass, a quick-amount button, and the custom input), toggling History, toggling Settings, turning reminders on/off, and confirm no console errors appear.

- [ ] **Step 4: Push everything to origin main**

```bash
git push origin main
```
