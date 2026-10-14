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
