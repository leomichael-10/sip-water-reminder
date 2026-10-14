import { prisma } from "@/lib/db";
import { sendToDevice } from "@/lib/push";
import { dueSupplement, reminderMessage, shouldRemind, supplementMessage } from "@/lib/schedule";
import { isToday, startOfLocalDay } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Hit this every 15 minutes from an external scheduler (e.g. cron-job.org).
 * Auth: header `Authorization: Bearer <CRON_SECRET>`, or `?key=<CRON_SECRET>`.
 * Sends both water reminders and vitamin/supplement nudges — the two are
 * fully independent: pausing water reminders or reaching the water goal
 * never stops a due vitamin nudge, and vice versa.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const key = new URL(req.url).searchParams.get("key");
  const auth = req.headers.get("authorization");
  if (!secret || (auth !== `Bearer ${secret}` && key !== secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  // Record that the scheduler fired, regardless of what happens below — this
  // is the heartbeat the UI uses to tell "cron is just between ticks" apart
  // from "cron has actually stopped running".
  await prisma.appMeta.upsert({
    where: { id: "singleton" },
    update: { lastCronAt: now },
    create: { id: "singleton", lastCronAt: now },
  });

  const devices = await prisma.device.findMany({
    where: { subscriptions: { some: {} } },
    include: {
      logs: { orderBy: { createdAt: "desc" }, take: 1 },
      supplements: { where: { enabled: true } },
    },
  });

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

  return Response.json({ at: now.toISOString(), results });
}
