# Sip Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optimistic updates, offline-friendly local caching, a 7-day history chart with streak, a custom amount input, a predicted next-reminder time, system-following light mode, and a goal-reached celebration — on top of the already-fixed loading bug. Then add vitamin/supplement reminders (Feature A) and restyle the app around a blue butterfly theme, including a new app icon (Feature B).

**Architecture:** Keep the existing single-page client component (`app/page.tsx`) as the UI host. Pure, testable logic (streak/history bucketing, next-reminder prediction, supplement due-checking) lives in `lib/`, following the existing `lib/schedule.ts` / `lib/time.ts` pattern. New API routes (`/api/history`, `/api/supplements`, `/api/supplements/log`) follow the existing route conventions in `app/api/*`. Supplements get their own Prisma models (`Supplement`, `SupplementLog`), parallel to the existing `WaterLog`, and their own push-notification tag so they never collide with water reminders. No state management library, no chart library, no new UI framework.

**Tech Stack:** Next.js 15 App Router, Prisma 6 + Neon Postgres, Tailwind v4 (CSS-variable theming), plain SVG for the chart, `node:test` + `tsx` (new, lightweight devDependency) for pure-function tests. The new app icon is rasterized from hand-authored SVG using `sharp`, which is already present in `node_modules` as a transitive/optional dependency of Next.js — used ad hoc via a throwaway script, never added to `package.json`, so it adds no new dependency.

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
- **A vitamin added after its time already passed today** — must not immediately nudge retroactively; it should only start being due from its next occurrence onward (`createdAt` vs. today's due instant).
- **A vitamin nudged exactly twice with no response** — the cron job must stop forever for that day once `nudgesSentToday >= 2`, never a third push, and must resume normally the next day once the goal-equivalent "taken today" check naturally resets at local midnight.
- **Water and vitamin reminders must stay fully independent** — reaching the water goal must not suppress a due vitamin nudge, and marking a vitamin taken must not touch `Device.lastSentAt` or reset the water reminder timer (and vice versa).

**Known limitation, accepted rather than engineered around:** a vitamin scheduled very close to local midnight (e.g. 11:30 PM) whose first nudge fires, then crosses into the next calendar day before the 1-hour re-nudge window closes, may not get its re-nudge — `dueSupplement`'s due-time calculation is always relative to "today" as seen from `now`, so a day boundary between the two nudges shifts what "today's due time" means. This mirrors an existing rough edge in `shouldRemind`'s own day-boundary handling and isn't worth a stateful fix for a personal reminder app; a user can always just take a near-midnight vitamin on the first nudge.

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

## Task 12: Light mode + the blue butterfly palette

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx:11-16`

**Interfaces:** none (CSS/metadata only — no component code changes). This task now also sets the final color values for Feature B (the blue butterfly restyle), so the palette only needs to be chosen once.

- [ ] **Step 1: Replace the base (dark) theme colors in `app/globals.css` with the blue butterfly palette**

Replace the existing `@theme { ... }` block:

```css
@theme {
  --color-ink: #0b1e33;
  --color-deep: #0f2a47;
  --color-water: #38bdf8;
  --color-foam: #e0f2fe;
}
```

with:

```css
@theme {
  --color-ink: #0a1430;
  --color-deep: #142a5e;
  --color-water: #4fa8ff;
  --color-foam: #eaf2ff;
}
```

(Deep navy background, indigo-blue cards, a bright cobalt "butterfly blue" accent, soft near-white blue-tinted text — the same four roles as before, just re-hued toward the new blue-butterfly identity instead of the original sky-blue.)

- [ ] **Step 2: Add light-theme token overrides**

Right after the `@theme { ... }` block, add:

```css
@media (prefers-color-scheme: light) {
  :root {
    --color-ink: #eef4ff;
    --color-deep: #d7e6ff;
    --color-water: #2f6fe0;
    --color-foam: #0a1430;
  }
}
```

(These four custom properties are the only color source for every `bg-*`/`text-*`/`border-*` utility in the app — Tailwind v4's `@theme` block makes each utility reference the CSS variable rather than inlining its value, so overriding them here re-themes the whole UI with zero component changes. Each name keeps its structural *role* — `ink` = page background, `deep` = card background, `water` = accent, `foam` = primary foreground — while its literal color flips for light mode. This is why elements that intentionally invert foreground/background in the dark theme, like the "Turn on reminders" button (`bg-foam text-ink`), keep the same *relative* contrast in light mode instead of breaking.)

- [ ] **Step 3: Add matching theme-color meta tags in `app/layout.tsx`**

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
    { media: "(prefers-color-scheme: dark)", color: "#0a1430" },
    { media: "(prefers-color-scheme: light)", color: "#eef4ff" },
  ],
};
```

- [ ] **Step 4: Manually verify in a browser**

Run: `npm run dev`, open the app, and toggle the OS/browser color-scheme preference (in Chrome devtools: Rendering tab → "Emulate CSS media feature prefers-color-scheme"). Confirm the whole UI re-themes to the new blue-butterfly palette in both modes — background, cards, text, the "Turn on reminders" pill, the glass border — with no illegible or low-contrast combinations, and confirm dark is still the default when no preference is set. (Task 26 does a dedicated contrast pass once the icon and emoji placements from Feature B are also in.)

- [ ] **Step 5: Commit**

```bash
git add app/globals.css app/layout.tsx
git commit -m "Add light theme and the blue butterfly color palette"
```

---

## Task 13: Goal-reached celebration — butterflies fluttering up

**Files:**
- Modify: `app/globals.css`
- Modify: `app/page.tsx` (new effect + state, new render block)

**Interfaces:** none new — purely additive state/effect in the existing component.

- [ ] **Step 1: Add the animation to `app/globals.css`**

After the existing `.wave` rule and its reduced-motion override, add:

```css
@keyframes flutter-up {
  0% { transform: translateY(0) translateX(0) rotate(0deg) scale(0.6); opacity: 0; }
  15% { opacity: 1; }
  50% { transform: translateY(-120px) translateX(var(--drift, 12px)) rotate(10deg) scale(1); }
  100% { transform: translateY(-260px) translateX(calc(var(--drift, 12px) * -1)) rotate(-8deg) scale(0.9); opacity: 0; }
}
.flutter { animation: flutter-up 1.8s ease-out forwards; }
@media (prefers-reduced-motion: reduce) {
  .flutter { animation: none; opacity: 1; transform: none; }
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
  const t = setTimeout(() => setCelebrate(false), 2000);
  return () => clearTimeout(t);
}, [celebrate]);
```

Add a small fixed set of butterflies with staggered delay/drift/position — no `Math.random()` at render time, so the component stays deterministic across re-renders:

```typescript
const BUTTERFLIES = [
  { left: "30%", delay: "0ms", drift: "-16px" },
  { left: "48%", delay: "120ms", drift: "20px" },
  { left: "62%", delay: "60ms", drift: "-10px" },
  { left: "40%", delay: "200ms", drift: "14px" },
  { left: "55%", delay: "260ms", drift: "-18px" },
];
```

(Place this constant near the other module-level constants at the top of the file, alongside `LOAD_TIMEOUT_MS` — it never changes, so it doesn't belong inside the component body.)

Add the render block right after the opening `<main ...>` tag of the main return (before the `<header>`):

```tsx
{celebrate && (
  <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
    {BUTTERFLIES.map((b, i) => (
      <span
        key={i}
        className="flutter absolute bottom-24 text-4xl"
        style={{ left: b.left, animationDelay: b.delay, "--drift": b.drift } as React.CSSProperties}
      >
        🦋
      </span>
    ))}
  </div>
)}
```

- [ ] **Step 3: Manually verify, including reduced motion**

Run: `npm run dev`. Log drinks until you hit the daily goal — confirm five 🦋 flutter up from near the bottom of the screen with a slight staggered delay and side-to-side drift, fading out after under 2 seconds, without blocking any taps underneath (`pointer-events-none`). Then enable "prefers reduced motion" in your OS accessibility settings (or devtools' Rendering tab → "Emulate CSS media feature prefers-reduced-motion: reduce") and repeat — confirm the butterflies still appear and disappear on the same timer, but stay in place rather than flying up.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css app/page.tsx
git commit -m "Add butterfly celebration on reaching the daily goal, respecting prefers-reduced-motion"
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

(This is a checkpoint, not the end of the plan — Tasks 15–23 add Feature A, Tasks 24–26 add Feature B, and Task 27 is the real final verification and push.)

---

## Task 15: Prisma schema for supplements

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `Supplement` and `SupplementLog` Prisma models, a `supplements` back-relation on `Device`. Consumed by every later Feature A task.

- [ ] **Step 1: Add the models**

In `prisma/schema.prisma`, add `supplements Supplement[]` to the `Device` model's relations (alongside the existing `subscriptions`/`logs` lines):

```prisma
  subscriptions PushSubscription[]
  logs          WaterLog[]
  supplements   Supplement[]
```

Then add two new models after `WaterLog`:

```prisma
/// Something taken on a daily schedule (a vitamin, a pill) — independent of water tracking.
model Supplement {
  id          String    @id @default(cuid())
  deviceId    String
  device      Device    @relation(fields: [deviceId], references: [id], onDelete: Cascade)
  name        String
  timeOfDay   String    // "HH:MM", 24h, in the device's local time zone
  enabled     Boolean   @default(true)
  lastNudgeAt DateTime?
  nudgesToday Int       @default(0)
  createdAt   DateTime  @default(now())

  logs SupplementLog[]

  @@index([deviceId])
}

model SupplementLog {
  id           String     @id @default(cuid())
  supplementId String
  supplement   Supplement @relation(fields: [supplementId], references: [id], onDelete: Cascade)
  deviceId     String
  takenAt      DateTime   @default(now())

  @@index([supplementId, takenAt])
  @@index([deviceId, takenAt])
}
```

- [ ] **Step 2: Push the schema**

Run: `npx prisma db push`
Expected: `Your database is now in sync with your Prisma schema.`, followed by Prisma Client regenerating.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma
git commit -m "Add Supplement and SupplementLog Prisma models"
```

---

## Task 16: `lib/time.ts` helpers for supplement timing

**Files:**
- Modify: `lib/time.ts`
- Create: `lib/time.test.ts`

**Interfaces:**
- Produces: `export function localTimeToday(tz: string, now: Date, hhmm: string): Date`, `export function isToday(tz: string, now: Date, instant: Date): boolean`. Consumed by Task 17 (`lib/schedule.ts`) and Task 21 (the cron route).

- [ ] **Step 1: Write the failing tests**

Create `lib/time.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (after adding `lib/time.test.ts` to the script — see Step 4)
Expected: FAIL — `isToday`/`localTimeToday` not exported from `./time`.

- [ ] **Step 3: Implement the helpers**

Add to `lib/time.ts`, after `inWindow`:

```typescript
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
```

- [ ] **Step 4: Add this file to the test script**

Update `package.json`'s `"test"` script to include it:

```json
"test": "node --import tsx --test lib/schedule.test.ts lib/history.test.ts lib/time.test.ts",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass, including the 4 new ones in `lib/time.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/time.ts lib/time.test.ts package.json
git commit -m "Add localTimeToday and isToday helpers to lib/time.ts"
```

---

## Task 17: `dueSupplement` in `lib/schedule.ts`

**Files:**
- Modify: `lib/schedule.ts`
- Create: `lib/schedule-supplements.test.ts`

**Interfaces:**
- Consumes: `localTimeToday` from `./time` (Task 16).
- Produces: `export type SupplementInput`, `export type SupplementDecision`, `export function dueSupplement(i: SupplementInput): SupplementDecision`, `export function dueSupplements<T extends SupplementInput>(items: T[]): T[]`, `export function supplementMessage(name: string, supplementId: string): { title: string; body: string; url: string; tag: string }`. Consumed by Task 21 (the cron route).

- [ ] **Step 1: Write the failing tests**

Create `lib/schedule-supplements.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` (after adding this file to the script — see Step 4)
Expected: FAIL — none of `dueSupplement`/`dueSupplements`/`supplementMessage` exist yet.

- [ ] **Step 3: Implement in `lib/schedule.ts`**

Update the import line to pull in `localTimeToday`:

```typescript
import { inWindow, localHour, localTimeToday, startOfLocalDay } from "./time";
```

Add, after `nextReminderAt`:

```typescript
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

/** Should a vitamin/supplement nudge go out right now? Up to 2 nudges/day: one at the scheduled time, one re-nudge an hour later if still not taken. */
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

/** Filters a list of supplements (each tagged with whatever `id` type the caller uses) down to the ones due right now. */
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
```

(`Decision` is the same `{ send: true } | { send: false; reason: string }` type already defined earlier in this file for `shouldRemind` — reused here rather than duplicated.)

- [ ] **Step 4: Add this file to the test script**

```json
"test": "node --import tsx --test lib/schedule.test.ts lib/schedule-supplements.test.ts lib/history.test.ts lib/time.test.ts",
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass, including the 12 new ones in `lib/schedule-supplements.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/schedule.ts lib/schedule-supplements.test.ts package.json
git commit -m "Add dueSupplement/dueSupplements/supplementMessage to lib/schedule.ts"
```

---

## Task 18: Per-notification tags in `lib/push.ts` and `public/sw.js`

**Files:**
- Modify: `lib/push.ts`
- Modify: `public/sw.js`
- Modify: `lib/schedule.ts` (one-line addition to `reminderMessage`'s return value)

**Interfaces:**
- Produces: `PushPayload` gains an optional `tag?: string`. Consumed by Task 21 (the cron route sends `supplementMessage(...)`'s payload, which includes a `tag`).

- [ ] **Step 1: Widen `PushPayload` in `lib/push.ts`**

Replace:

```typescript
export type PushPayload = { title: string; body: string; url?: string };
```

with:

```typescript
export type PushPayload = { title: string; body: string; url?: string; tag?: string };
```

(No other change needed in this file — `sendNotification(..., JSON.stringify(payload), ...)` already serializes whatever's on `payload`, `tag` included.)

- [ ] **Step 2: Make the service worker use the tag from the payload**

In `public/sw.js`, inside the `push` event listener, replace:

```javascript
  const title = data.title || "Drink water 💧";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Time for a glass of water.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "water-reminder",
      renotify: true,
      data: { url: data.url || "/" },
    })
  );
```

with:

```javascript
  const title = data.title || "Drink water 💧";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "Time for a glass of water.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "water-reminder",
      renotify: true,
      data: { url: data.url || "/" },
    })
  );
```

- [ ] **Step 3: Make the water reminder's own tag explicit**

In `lib/schedule.ts`, `reminderMessage` currently returns:

```typescript
  return {
    title: "Drink water 💧",
    body: `${line} ${todayMl.toLocaleString("en-US")} / ${goalMl.toLocaleString("en-US")} ml today, ${left.toLocaleString("en-US")} ml to go.`,
    url: "/?from=reminder",
  };
```

Add a `tag`:

```typescript
  return {
    title: "Drink water 💧",
    body: `${line} ${todayMl.toLocaleString("en-US")} / ${goalMl.toLocaleString("en-US")} ml today, ${left.toLocaleString("en-US")} ml to go.`,
    url: "/?from=reminder",
    tag: "water-reminder",
  };
```

(This is now redundant with the service worker's `"water-reminder"` fallback, but being explicit here means the water reminder's tag lives next to the vitamin tag's definition in the same file, instead of being an implicit default buried in `sw.js`.)

- [ ] **Step 4: Manually verify**

Run: `npm run build` (type-check only — there's no local push-notification testing without a subscribed device; this step just confirms nothing broke). Once deployed, triggering both a water reminder and a due vitamin for the same device should produce two separate notifications (different tags), not one replacing the other.

- [ ] **Step 5: Commit**

```bash
git add lib/push.ts public/sw.js lib/schedule.ts
git commit -m "Support per-notification tags so vitamin and water pushes don't collide"
```

---

## Task 19: Supplements in `deviceState()` and `State`

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/device.ts`

**Interfaces:**
- Produces: `export type SupplementView = { id: string; name: string; timeOfDay: string; enabled: boolean; takenToday: boolean }`, `State.supplements: SupplementView[]`. Consumed by Task 20 (the supplement routes), Task 22 (home screen checklist), Task 23 (Settings management UI).

- [ ] **Step 1: Add the type to `lib/types.ts`**

```typescript
export type SupplementView = {
  id: string;
  name: string;
  timeOfDay: string;
  enabled: boolean;
  takenToday: boolean;
};
```

Add `supplements: SupplementView[];` as a new field on `State`:

```typescript
export type State = {
  settings: Settings;
  todayMl: number;
  logs: LogEntry[];
  subscribed: boolean;
  nextReminderAt: string | null;
  supplements: SupplementView[];
};
```

- [ ] **Step 2: Compute it in `deviceState()`**

In `lib/device.ts`, add a helper above `deviceState`:

```typescript
async function supplementsToday(deviceId: string, tz: string): Promise<SupplementView[]> {
  const supplements = await prisma.supplement.findMany({ where: { deviceId }, orderBy: { timeOfDay: "asc" } });
  const todayStart = startOfLocalDay(tz);
  const takenIds = new Set(
    (
      await prisma.supplementLog.findMany({
        where: { deviceId, takenAt: { gte: todayStart } },
        select: { supplementId: true },
      })
    ).map((l) => l.supplementId)
  );
  return supplements.map((s) => ({
    id: s.id,
    name: s.name,
    timeOfDay: s.timeOfDay,
    enabled: s.enabled,
    takenToday: takenIds.has(s.id),
  }));
}
```

Add `import type { SupplementView } from "./types";` at the top of `lib/device.ts`.

In `deviceState()`, add `supplementsToday(id, device.timezone)` to the existing `Promise.all`, and add `supplements` to the returned object:

```typescript
export async function deviceState(id: string) {
  const device = await getOrCreateDevice(id);
  const now = new Date();
  const [logs, subCount, lastLog, supplements] = await Promise.all([
    todayLogs(id, device.timezone),
    prisma.pushSubscription.count({ where: { deviceId: id } }),
    prisma.waterLog.findFirst({ where: { deviceId: id }, orderBy: { createdAt: "desc" } }),
    supplementsToday(id, device.timezone),
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
    supplements,
  };
}
```

- [ ] **Step 3: Verify the type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts lib/device.ts
git commit -m "Include today's supplement checklist in deviceState()"
```

---

## Task 20: Supplement CRUD and taken/undo routes

**Files:**
- Create: `app/api/supplements/route.ts`
- Create: `app/api/supplements/log/route.ts`

**Interfaces:**
- Consumes: `bad`, `getOrCreateDevice`, `validDeviceId`, `deviceState` from `@/lib/device`; `prisma` from `@/lib/db`.
- Produces: `POST`/`PUT`/`DELETE /api/supplements`, `POST`/`DELETE /api/supplements/log` — all return the full `deviceState()` JSON, matching every other mutation route in this app. Consumed by Task 22 and Task 23.

- [ ] **Step 1: Create `app/api/supplements/route.ts`**

```typescript
import { prisma } from "@/lib/db";
import { bad, deviceState, getOrCreateDevice, validDeviceId } from "@/lib/device";

export const dynamic = "force-dynamic";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Body: { deviceId, name, timeOfDay } — adds a new vitamin/supplement. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validDeviceId(body.deviceId)) return bad("invalid deviceId");
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
  if (!name) return bad("name is required");
  if (typeof body.timeOfDay !== "string" || !TIME_RE.test(body.timeOfDay)) return bad("timeOfDay must be HH:MM");

  await getOrCreateDevice(body.deviceId);
  await prisma.supplement.create({ data: { deviceId: body.deviceId, name, timeOfDay: body.timeOfDay } });
  return Response.json(await deviceState(body.deviceId));
}

/** Body: { deviceId, id, name?, timeOfDay?, enabled? } — edits an existing vitamin/supplement. */
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validDeviceId(body.deviceId) || typeof body.id !== "string") return bad("invalid deviceId or id");

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().slice(0, 100);
  if (typeof body.timeOfDay === "string" && TIME_RE.test(body.timeOfDay)) data.timeOfDay = body.timeOfDay;
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;

  await prisma.supplement.updateMany({ where: { id: body.id, deviceId: body.deviceId }, data });
  return Response.json(await deviceState(body.deviceId));
}

/** Body: { deviceId, id } — removes a vitamin/supplement (and its log history, via cascade). */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validDeviceId(body.deviceId) || typeof body.id !== "string") return bad("invalid deviceId or id");

  await prisma.supplement.deleteMany({ where: { id: body.id, deviceId: body.deviceId } });
  return Response.json(await deviceState(body.deviceId));
}
```

(`updateMany`/`deleteMany` scoped by `{ id, deviceId }` together — rather than `update`/`delete` by `id` alone — so one device can never edit or delete another device's supplement row, even though `Supplement.id` isn't namespaced by device.)

- [ ] **Step 2: Create `app/api/supplements/log/route.ts`**

```typescript
import { prisma } from "@/lib/db";
import { bad, deviceState, validDeviceId } from "@/lib/device";
import { startOfLocalDay } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Body: { deviceId, supplementId } — marks a vitamin taken right now. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validDeviceId(body.deviceId) || typeof body.supplementId !== "string") {
    return bad("invalid deviceId or supplementId");
  }
  const supplement = await prisma.supplement.findFirst({
    where: { id: body.supplementId, deviceId: body.deviceId },
  });
  if (!supplement) return bad("supplement not found", 404);

  await prisma.supplementLog.create({ data: { supplementId: supplement.id, deviceId: body.deviceId } });
  return Response.json(await deviceState(body.deviceId));
}

/** Body: { deviceId, supplementId } — undoes today's most recent "taken" mark for this vitamin. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validDeviceId(body.deviceId) || typeof body.supplementId !== "string") {
    return bad("invalid deviceId or supplementId");
  }
  const device = await prisma.device.findUnique({ where: { id: body.deviceId } });
  if (!device) return bad("device not found", 404);

  const latest = await prisma.supplementLog.findFirst({
    where: { supplementId: body.supplementId, deviceId: body.deviceId, takenAt: { gte: startOfLocalDay(device.timezone) } },
    orderBy: { takenAt: "desc" },
  });
  if (latest) await prisma.supplementLog.delete({ where: { id: latest.id } });
  return Response.json(await deviceState(body.deviceId));
}
```

- [ ] **Step 3: Manually verify against a running dev server**

Run: `npm run dev`, then:
```bash
curl -s -X POST http://localhost:3000/api/supplements -H "Content-Type: application/json" -d '{"deviceId":"test-device-123","name":"Multivitamin","timeOfDay":"09:00"}'
```
Expected: a 200 response whose `supplements` array contains the new entry with `takenToday: false`. Then:
```bash
curl -s -X POST http://localhost:3000/api/supplements/log -H "Content-Type: application/json" -d '{"deviceId":"test-device-123","supplementId":"<id from the previous response>"}'
```
Expected: `takenToday: true` for that entry in the response.

- [ ] **Step 4: Commit**

```bash
git add app/api/supplements
git commit -m "Add supplement CRUD and taken/undo routes"
```

---

## Task 21: Vitamin nudges in the cron job

**Files:**
- Modify: `app/api/cron/remind/route.ts`

**Interfaces:**
- Consumes: `dueSupplements`, `supplementMessage` from `@/lib/schedule` (Task 17); `isToday` from `@/lib/time` (Task 16).

- [ ] **Step 1: Extend the device query to include supplements**

Replace the `devices` query:

```typescript
  const devices = await prisma.device.findMany({
    where: { enabled: true, subscriptions: { some: {} } },
    include: { logs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
```

with (dropping the `enabled: true` filter at the top level, since a device with water reminders paused can still have active vitamin reminders — `enabled` is checked per-concern below instead):

```typescript
  const devices = await prisma.device.findMany({
    where: { subscriptions: { some: {} } },
    include: {
      logs: { orderBy: { createdAt: "desc" }, take: 1 },
      supplements: { where: { enabled: true } },
    },
  });
```

- [ ] **Step 2: Keep the water-reminder branch gated on the device's own `enabled`, then add the supplement branch**

The existing per-device loop currently starts with computing `todayMl` and calling `shouldRemind`. Wrap that in an `if (d.enabled)` check (since the `enabled: true` filter was removed from the query above), and add supplement handling after it:

```typescript
  const results: { device: string; result: string }[] = [];
  for (const d of devices) {
    if (d.enabled) {
      const agg = await prisma.waterLog.aggregate({
        where: { deviceId: d.id, createdAt: { gte: startOfLocalDay(d.timezone, now) } },
        _sum: { amountMl: true },
      });
      const todayMl = agg._sum.amountMl ?? 0;

      const decision = shouldRemind({
        now,
        timezone: d.timezone,
        intervalMin: d.intervalMin,
        startHour: d.startHour,
        endHour: d.endHour,
        goalMl: d.goalMl,
        enabled: d.enabled,
        todayMl,
        lastSentAt: d.lastSentAt,
        lastLogAt: d.logs[0]?.createdAt ?? null,
      });

      if (!decision.send) {
        results.push({ device: d.id.slice(0, 8), result: `water: ${decision.reason}` });
      } else {
        const sent = await sendToDevice(d.id, reminderMessage(todayMl, d.goalMl, now));
        if (sent) await prisma.device.update({ where: { id: d.id }, data: { lastSentAt: now } });
        results.push({ device: d.id.slice(0, 8), result: `water: sent to ${sent}` });
      }
    }

    for (const supp of d.supplements) {
      const takenToday = await prisma.supplementLog.findFirst({
        where: { supplementId: supp.id, takenAt: { gte: startOfLocalDay(d.timezone, now) } },
      });
      const nudgesSentToday =
        supp.lastNudgeAt && isToday(d.timezone, now, supp.lastNudgeAt) ? supp.nudgesToday : 0;

      const decision = dueSupplement({
        now,
        timezone: d.timezone,
        timeOfDay: supp.timeOfDay,
        enabled: supp.enabled,
        createdAt: supp.createdAt,
        takenToday: Boolean(takenToday),
        nudgesSentToday,
        lastNudgeAt: supp.lastNudgeAt,
      });

      if (!decision.send) {
        results.push({ device: d.id.slice(0, 8), result: `${supp.name}: ${decision.reason}` });
        continue;
      }

      const sent = await sendToDevice(d.id, supplementMessage(supp.name, supp.id));
      if (sent) {
        await prisma.supplement.update({
          where: { id: supp.id },
          data: { lastNudgeAt: now, nudgesToday: nudgesSentToday + 1 },
        });
      }
      results.push({ device: d.id.slice(0, 8), result: `${supp.name}: sent to ${sent}` });
    }
  }
```

(Note this replaces the body of the existing `for (const d of devices) { ... }` loop entirely — the water-reminder logic inside the `if (d.enabled)` block is the same as before, just re-indented one level and with its `results.push` messages prefixed `water:` to distinguish them from supplement entries in the same response.)

Update the imports at the top of the file:

```typescript
import { prisma } from "@/lib/db";
import { sendToDevice } from "@/lib/push";
import { dueSupplement, reminderMessage, shouldRemind, supplementMessage } from "@/lib/schedule";
import { isToday, startOfLocalDay } from "@/lib/time";
```

- [ ] **Step 3: Manually verify**

Run: `npm run build` to confirm it type-checks. Then, against a device with an active subscription and a supplement whose `timeOfDay` is a couple of minutes in the past, hit `/api/cron/remind?key=<CRON_SECRET>` and confirm the JSON response includes a `"<name>: sent to 1"` entry, and that a second immediate call shows `"<name>: too soon for re-nudge"` (not due again until the 1-hour window).

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/remind/route.ts
git commit -m "Send vitamin nudges from the cron job, independent of water reminders"
```

---

## Task 22: "Vitamins today" checklist on the home screen

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `state.supplements` (Task 19), `commit` (Task 7).

- [ ] **Step 1: Add the toggle handler**

Add after the `drink` callback:

```typescript
const toggleSupplement = useCallback(
  async (supplementId: string, takenToday: boolean) => {
    if (!deviceId || !state) return;
    const previous = state;
    setState({
      ...state,
      supplements: state.supplements.map((v) => (v.id === supplementId ? { ...v, takenToday: !takenToday } : v)),
    });
    try {
      commit(
        takenToday
          ? await api("/api/supplements/log", "DELETE", { deviceId, supplementId })
          : await api("/api/supplements/log", "POST", { deviceId, supplementId })
      );
    } catch (e) {
      setState(previous);
      flash((e as Error).message);
    }
  },
  [deviceId, state]
);
```

- [ ] **Step 2: Add the section**

After the `{/* Today */}` section's closing `</section>`, add:

```tsx
{/* Vitamins */}
{state.supplements.length > 0 && (
  <section className="mt-6 rounded-3xl bg-deep p-5">
    <div className="flex items-center justify-between">
      <h2 className="font-semibold">Vitamins today</h2>
      <span className="text-sm text-foam/60">
        {state.supplements.filter((v) => v.takenToday).length} of {state.supplements.length} taken
      </span>
    </div>
    <ul className="mt-3 space-y-2">
      {state.supplements.map((v) => (
        <li key={v.id}>
          <button
            onClick={() => toggleSupplement(v.id, v.takenToday)}
            className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm active:scale-[0.98] ${
              v.takenToday ? "bg-water/15 text-foam" : "bg-ink text-foam/80"
            }`}
          >
            <span>{v.takenToday ? "✅" : "🦋"} {v.name}</span>
            <span className="text-foam/50">{v.timeOfDay}</span>
          </button>
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, add a vitamin via Settings (Task 23 — do this step after that task lands), then tap it on the home screen — confirm it flips to ✅ instantly (optimistic), the "N of M taken" count updates, and tapping again un-checks it. With the network offline, confirm a tap reverts after the request fails and shows a toast.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "Add Vitamins today checklist with optimistic toggle"
```

---

## Task 23: Settings UI to manage vitamins

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `app/api/supplements` (Task 20), `commit` (Task 7).

- [ ] **Step 1: Add state and handlers**

Add alongside `customMl`:

```typescript
const [newSuppName, setNewSuppName] = useState("");
const [newSuppTime, setNewSuppTime] = useState("09:00");
```

Add after `toggleSupplement`:

```typescript
const addSupplement = async () => {
  if (!newSuppName.trim()) return;
  try {
    commit(await api("/api/supplements", "POST", { deviceId, name: newSuppName.trim(), timeOfDay: newSuppTime }));
    setNewSuppName("");
  } catch (e) {
    flash((e as Error).message);
  }
};

const updateSupplement = async (id: string, patch: { name?: string; timeOfDay?: string; enabled?: boolean }) => {
  try {
    commit(await api("/api/supplements", "PUT", { deviceId, id, ...patch }));
  } catch (e) {
    flash((e as Error).message);
  }
};

const deleteSupplement = async (id: string) => {
  try {
    commit(await api("/api/supplements", "DELETE", { deviceId, id }));
  } catch (e) {
    flash((e as Error).message);
  }
};
```

- [ ] **Step 2: Add the management UI inside the `{showSettings && (...)}` section**

Right before the closing `<p className="text-foam/50">Time zone: {s.timezone}</p>` line, add:

```tsx
<div className="space-y-2 border-t border-foam/10 pt-4">
  <p className="text-foam/80">Vitamins</p>
  {state.supplements.map((v) => (
    <div key={v.id} className="flex items-center gap-2">
      <input
        defaultValue={v.name}
        onBlur={(e) => e.target.value.trim() && e.target.value !== v.name && updateSupplement(v.id, { name: e.target.value.trim() })}
        className="sel min-w-0 flex-1"
      />
      <input
        type="time"
        defaultValue={v.timeOfDay}
        onBlur={(e) => e.target.value !== v.timeOfDay && updateSupplement(v.id, { timeOfDay: e.target.value })}
        className="sel"
      />
      <button onClick={() => deleteSupplement(v.id)} className="text-water active:opacity-60">
        Delete
      </button>
    </div>
  ))}
  <div className="flex items-center gap-2">
    <input
      placeholder="Vitamin name"
      value={newSuppName}
      onChange={(e) => setNewSuppName(e.target.value)}
      className="sel min-w-0 flex-1"
    />
    <input type="time" value={newSuppTime} onChange={(e) => setNewSuppTime(e.target.value)} className="sel" />
    <button onClick={addSupplement} className="rounded-xl bg-ink px-3 py-2 font-medium active:scale-95">
      Add
    </button>
  </div>
</div>
```

(`defaultValue` + `onBlur` rather than a fully controlled `value`/`onChange` keeps every keystroke from round-tripping to the server — the edit only saves once the field loses focus, matching how the rest of Settings behaves on discrete choices rather than free text.)

- [ ] **Step 3: Manually verify**

Run: `npm run dev`, open Settings, add "Multivitamin" at a time a few minutes from now, confirm it appears both in Settings and in the home screen's "Vitamins today" checklist, edit its name/time by blurring the field after changing it, and delete it — confirm each action updates the list without a page reload.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "Add Settings UI to manage vitamins"
```

---

## Task 24: New blue butterfly app icon

**Files:**
- Create: `public/butterfly-icon-source.svg` (kept as the editable source, not referenced by the app)
- Modify (binary): `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`

**Interfaces:** none (static assets only — `app/manifest.ts` and `app/layout.tsx` already reference these exact file paths, so no code changes needed).

- [ ] **Step 1: Author the SVG**

Create `public/butterfly-icon-source.svg` — an original, hand-drawn geometric butterfly (not traced from any emoji font), using the same palette as Task 12, with a solid background so it works as a maskable icon:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0a1430"/>
  <ellipse cx="50" cy="50" rx="2.5" ry="18" fill="#eaf2ff"/>
  <path d="M48 36 Q45 29 41 25" stroke="#eaf2ff" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M52 36 Q55 29 59 25" stroke="#eaf2ff" stroke-width="1.6" fill="none" stroke-linecap="round"/>
  <path d="M48 42 C 34 22, 16 24, 18 40 C 19 50, 34 51, 48 46 Z" fill="#4fa8ff"/>
  <path d="M48 50 C 37 57, 25 65, 28 74 C 31 81, 42 75, 48 60 Z" fill="#2f6fe0"/>
  <path d="M52 42 C 66 22, 84 24, 82 40 C 81 50, 66 51, 52 46 Z" fill="#4fa8ff"/>
  <path d="M52 50 C 63 57, 75 65, 72 74 C 69 81, 58 75, 52 60 Z" fill="#2f6fe0"/>
  <circle cx="29" cy="34" r="3" fill="#eaf2ff" opacity="0.8"/>
  <circle cx="71" cy="34" r="3" fill="#eaf2ff" opacity="0.8"/>
</svg>
```

- [ ] **Step 2: Rasterize to PNGs with `sharp` (already present, no new dependency)**

Run this ad hoc from the project root — it's a one-time asset generation script, not part of the app, so it isn't saved anywhere permanent:

```bash
node -e "
const sharp = require('sharp');
const fs = require('fs');
const svg = fs.readFileSync('public/butterfly-icon-source.svg');
Promise.all([
  sharp(svg).resize(192, 192).png().toFile('public/icon-192.png'),
  sharp(svg).resize(512, 512).png().toFile('public/icon-512.png'),
  sharp(svg).resize(180, 180).png().toFile('public/apple-touch-icon.png'),
]).then(() => console.log('icons written')).catch((e) => { console.error(e); process.exit(1); });
"
```

Expected output: `icons written`.

- [ ] **Step 3: Manually verify**

Open each of the three PNGs (e.g. in the IDE's image preview, or `start public/icon-512.png` on Windows) and confirm the butterfly renders cleanly at every size, especially the smallest (192px) — no illegible fine detail. Run `npm run dev` and check the browser tab's favicon and the PWA install prompt's icon (Chrome devtools → Application → Manifest) show the new butterfly.

- [ ] **Step 4: Commit**

```bash
git add public/butterfly-icon-source.svg public/icon-192.png public/icon-512.png public/apple-touch-icon.png
git commit -m "Replace the app icon with an original blue butterfly design"
```

---

## Task 25: Butterfly emoji placements and manifest colors

**Files:**
- Modify: `app/page.tsx` (header, empty states)
- Modify: `app/manifest.ts`

**Interfaces:** none new — copy and metadata changes only.

- [ ] **Step 1: Add 🦋 to the header**

In `app/page.tsx`, change:

```tsx
<h1 className="text-2xl font-bold tracking-tight">Sip</h1>
```

to:

```tsx
<h1 className="text-2xl font-bold tracking-tight">Sip 🦋</h1>
```

- [ ] **Step 2: Add 🦋 to the empty states**

Change the "Nothing logged yet" line:

```tsx
<p className="mt-2 text-sm text-foam/50">Nothing logged yet.</p>
```

to:

```tsx
<p className="mt-2 text-sm text-foam/50">🦋 Nothing logged yet.</p>
```

And the no-streak line in `app/history-chart.tsx` (from Task 11):

```tsx
{streak > 0 ? `🔥 ${streak} day${streak === 1 ? "" : "s"} hitting your goal` : "Hit your goal today to start a streak."}
```

to:

```tsx
{streak > 0 ? `🔥 ${streak} day${streak === 1 ? "" : "s"} hitting your goal` : "🦋 Hit your goal today to start a streak."}
```

- [ ] **Step 3: Sync `app/manifest.ts` to the butterfly palette**

Replace:

```typescript
    background_color: "#0b1e33",
    theme_color: "#0b1e33",
```

with:

```typescript
    background_color: "#0a1430",
    theme_color: "#0a1430",
```

(Matching the dark-theme `--color-ink` value from Task 12 exactly — this is the color shown behind the icon during PWA launch, before the page itself paints.)

- [ ] **Step 4: Manually verify**

Run: `npm run dev`, confirm "Sip 🦋" shows in the header, the empty-logs and empty-streak states show the 🦋 copy, and (via devtools → Application → Manifest) the manifest's `background_color`/`theme_color` read `#0a1430`.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx app/history-chart.tsx app/manifest.ts
git commit -m "Add butterfly emoji placements and sync manifest colors to the new palette"
```

---

## Task 26: Contrast check across both themes

**Files:** none (verification only — fixes, if any are found, land as a follow-up edit to `app/globals.css` within this same task).

- [ ] **Step 1: Check every blue-on-blue text/background pairing**

Run: `npm run dev`. Using the browser's contrast checker (Chrome devtools → inspect an element → the color swatch on any `color`/`background-color` line shows a contrast ratio against its background) or a standalone checker with the hex values from Task 12, verify each of these pairs is at least 4.5:1 for normal text (3:1 is acceptable for large/bold text like headings and the big ml total):

- Dark: `--color-foam` (#eaf2ff) text on `--color-ink` (#0a1430) background
- Dark: `--color-foam` (#eaf2ff) text on `--color-deep` (#142a5e) background
- Dark: `--color-ink` (#0a1430) text on `--color-water` (#4fa8ff) background (the "+1 glass" and "Try again" buttons)
- Light: `--color-foam` (#0a1430) text on `--color-ink` (#eef4ff) background
- Light: `--color-foam` (#0a1430) text on `--color-deep` (#d7e6ff) background
- Light: `--color-ink` (#eef4ff) text on `--color-water` (#2f6fe0) background

- [ ] **Step 2: Fix any pairing that falls short**

If any ratio is below the target, adjust that specific CSS variable's value in `app/globals.css` (from Task 12) by a few percent lightness/darkness — keep the same hue family so it still reads as "blue butterfly," just shift until it passes. Re-check after each change.

- [ ] **Step 3: Re-run the full verification**

Run: `npm run build` to confirm the color change (if any) didn't break anything else.

- [ ] **Step 4: Commit (only if Step 2 required a change)**

```bash
git add app/globals.css
git commit -m "Adjust palette for contrast after manual check"
```

---

## Task 27: Final verification and push (everything)

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass across `lib/schedule.test.ts`, `lib/schedule-supplements.test.ts`, `lib/history.test.ts`, and `lib/time.test.ts`.

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: completes with no type errors, listing `/api/history`, `/api/supplements`, and `/api/supplements/log` among the routes.

- [ ] **Step 3: Full smoke test**

Run: `npm start`, open `http://localhost:3000`, and walk through: initial load (butterfly icon, "Sip 🦋" header), logging a drink three ways, toggling History, adding/editing/deleting a vitamin in Settings, checking it off on the home screen, toggling light/dark via devtools, and reaching the daily goal to see the butterfly celebration. Confirm no console errors.

- [ ] **Step 4: Push everything to origin main**

```bash
git push origin main
```

- [ ] **Step 5: Tell the user what to do in Vercel/cron-job.org**

Since this round adds new environment-free functionality (no new env vars needed) but does add two new routes the external cron job should know about implicitly (it already hits `/api/cron/remind`, which now also handles vitamins — no change needed to the cron-job.org configuration itself), the only follow-up for the user is: re-add the app to their iPhone Home Screen if they want the new icon to show (iOS caches the Home Screen icon at install time and won't pick up a changed one without removing and re-adding it).
