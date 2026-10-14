import { prisma } from "@/lib/db";
import { sendToDevice } from "@/lib/push";
import { reminderMessage, shouldRemind } from "@/lib/schedule";
import { startOfLocalDay } from "@/lib/time";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Hit this every 15 minutes from an external scheduler (e.g. cron-job.org).
 * Auth: header `Authorization: Bearer <CRON_SECRET>`, or `?key=<CRON_SECRET>`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const key = new URL(req.url).searchParams.get("key");
  const auth = req.headers.get("authorization");
  if (!secret || (auth !== `Bearer ${secret}` && key !== secret)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const devices = await prisma.device.findMany({
    where: { enabled: true, subscriptions: { some: {} } },
    include: { logs: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  const results: { device: string; result: string }[] = [];
  for (const d of devices) {
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
      results.push({ device: d.id.slice(0, 8), result: decision.reason });
      continue;
    }

    const sent = await sendToDevice(d.id, reminderMessage(todayMl, d.goalMl, now));
    if (sent) await prisma.device.update({ where: { id: d.id }, data: { lastSentAt: now } });
    results.push({ device: d.id.slice(0, 8), result: `sent to ${sent}` });
  }

  return Response.json({ at: now.toISOString(), results });
}
