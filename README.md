# Sip — water reminder PWA

Next.js 15 · Prisma · Neon · Web Push. Installs on your iPhone from Safari, sends "drink water" notifications on a schedule, and lets you log glasses toward a daily goal.

**How reminders work:** an external scheduler calls `/api/cron/remind` every 15 minutes. For each device the route checks your active hours, your interval, and your goal. It only sends a push when a reminder is due. Logging a drink resets the timer, and reminders stop for the day once you hit your goal.

> Why not Vercel Cron? On the Hobby (free) plan, Vercel cron jobs can only run once a day. A free external scheduler like cron-job.org fills that gap.

## 1. Set up locally

```bash
npm install
cp .env.example .env
npm run vapid          # prints a public + private key → paste both into .env
openssl rand -hex 32   # → CRON_SECRET in .env
```

Create a Neon project, copy its connection string into `DATABASE_URL`, then:

```bash
npm run db:push        # creates the tables
npm run dev
```

## 2. Deploy to Vercel

1. Push to GitHub and import the repo in Vercel.
2. Add these environment variables: `DATABASE_URL`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:your-email`), and `CRON_SECRET`.
3. Deploy. The build script runs `prisma generate` for you.

## 3. Schedule the reminders (cron-job.org, free)

1. Create a cron job with the URL `https://YOUR-APP.vercel.app/api/cron/remind`.
2. Set the schedule to **every 15 minutes**.
3. Under Advanced → Headers, add `Authorization: Bearer YOUR_CRON_SECRET`.
4. Run it once by hand. The response lists each device and why it did or didn't send.

## 4. Install on your iPhone (iOS 16.4+)

1. Open your Vercel URL in **Safari**.
2. Tap Share → **Add to Home Screen** → Add.
3. Open **Sip from the Home Screen**. Push only works in the installed app, not in a Safari tab.
4. Tap **Turn on reminders** → Allow, then tap **Send a test**.

## Notes

- **No login.** Each install gets a random device ID stored on the phone. That's fine for personal use. If you deploy publicly and want to keep strangers out, put the app behind Vercel's password protection or add auth.
- **Reinstalling** the Home Screen app creates a new device ID, which means fresh settings and history.
- **Notification taps** open the app with a "Reminder time" banner. iOS web push doesn't support action buttons, so logging takes one tap inside the app.
- **Settings:** interval (15 min–3 h), active hours (can wrap past midnight), daily goal, glass size. Time zone is picked up from the phone automatically.

## Files

| Path | What it does |
| --- | --- |
| `app/page.tsx` | The whole UI: glass, log buttons, reminder setup, settings, today's log |
| `public/sw.js` | Service worker that shows pushes and handles taps |
| `app/api/cron/remind` | Decides who gets a reminder and sends it |
| `lib/schedule.ts` | The timing rules (`shouldRemind`), kept pure so it's easy to test |
| `app/api/{state,log,settings,subscribe,test}` | Small JSON endpoints the UI calls |
| `prisma/schema.prisma` | `Device`, `PushSubscription`, `WaterLog` |
