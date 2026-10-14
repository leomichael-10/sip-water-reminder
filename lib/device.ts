import { prisma } from "./db";
import { nextReminderAt } from "./schedule";
import { startOfLocalDay } from "./time";
import type { SupplementView } from "./types";

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

export async function deviceState(id: string) {
  const device = await getOrCreateDevice(id);
  const now = new Date();
  const [logs, subCount, lastLog, supplements, appMeta] = await Promise.all([
    todayLogs(id, device.timezone),
    prisma.pushSubscription.count({ where: { deviceId: id } }),
    prisma.waterLog.findFirst({ where: { deviceId: id }, orderBy: { createdAt: "desc" } }),
    supplementsToday(id, device.timezone),
    prisma.appMeta.findUnique({ where: { id: "singleton" } }),
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
    lastCronAt: appMeta?.lastCronAt ? appMeta.lastCronAt.toISOString() : null,
    supplements,
  };
}

export const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status });
