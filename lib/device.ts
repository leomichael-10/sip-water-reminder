import { prisma } from "./db";
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
  const [logs, subCount] = await Promise.all([
    todayLogs(id, device.timezone),
    prisma.pushSubscription.count({ where: { deviceId: id } }),
  ]);
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
    todayMl: logs.reduce((s, l) => s + l.amountMl, 0),
    logs: logs.map((l) => ({ id: l.id, amountMl: l.amountMl, at: l.createdAt.toISOString() })),
    subscribed: subCount > 0,
  };
}

export const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status });
