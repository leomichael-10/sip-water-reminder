import { prisma } from "@/lib/db";
import { bad, deviceState, getOrCreateDevice, todayLogs, validDeviceId } from "@/lib/device";

export const dynamic = "force-dynamic";

/** Log a drink. Body: { deviceId, amountMl? } — defaults to the glass size. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validDeviceId(body.deviceId)) return bad("invalid deviceId");
  const device = await getOrCreateDevice(body.deviceId);
  const amount =
    typeof body.amountMl === "number" && body.amountMl > 0 && body.amountMl <= 3000
      ? Math.round(body.amountMl)
      : device.glassMl;
  await prisma.waterLog.create({ data: { deviceId: device.id, amountMl: amount } });
  return Response.json(await deviceState(device.id));
}

/** Undo: removes today's most recent log. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validDeviceId(body.deviceId)) return bad("invalid deviceId");
  const device = await getOrCreateDevice(body.deviceId);
  const [latest] = await todayLogs(device.id, device.timezone);
  if (latest) await prisma.waterLog.delete({ where: { id: latest.id } });
  return Response.json(await deviceState(device.id));
}
