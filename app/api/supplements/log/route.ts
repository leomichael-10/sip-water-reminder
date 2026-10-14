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
