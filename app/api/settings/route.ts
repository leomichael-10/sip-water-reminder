import { prisma } from "@/lib/db";
import { bad, deviceState, getOrCreateDevice, validDeviceId } from "@/lib/device";
import { isValidTimeZone } from "@/lib/time";

export const dynamic = "force-dynamic";

const int = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validDeviceId(body.deviceId)) return bad("invalid deviceId");
  await getOrCreateDevice(body.deviceId);

  const data: Record<string, unknown> = {};
  const intervalMin = int(body.intervalMin, 15, 360);
  if (intervalMin !== undefined) data.intervalMin = intervalMin;
  const startHour = int(body.startHour, 0, 23);
  if (startHour !== undefined) data.startHour = startHour;
  const endHour = int(body.endHour, 0, 23);
  if (endHour !== undefined) data.endHour = endHour;
  const goalMl = int(body.goalMl, 250, 10000);
  if (goalMl !== undefined) data.goalMl = goalMl;
  const glassMl = int(body.glassMl, 50, 2000);
  if (glassMl !== undefined) data.glassMl = glassMl;
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body.timezone === "string" && isValidTimeZone(body.timezone)) data.timezone = body.timezone;

  await prisma.device.update({ where: { id: body.deviceId }, data });
  return Response.json(await deviceState(body.deviceId));
}
